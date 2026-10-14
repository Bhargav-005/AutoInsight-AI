from io import BytesIO
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.metrics import accuracy_score, mean_absolute_error

from app.core.errors import AppError
from app.services import ml
from app.services.ml_contracts import TrainConfig


def fixture(task="classification", algorithm="logistic_regression"):
    rng = np.random.default_rng(84)
    x = rng.normal(size=200)
    frame = pd.DataFrame(
        {
            "column_001": x,
            "column_002": np.where(x > 0, "warm", "cool"),
            "column_003": np.where(x > 0, "yes", "no")
            if task == "classification"
            else 3 * x + rng.normal(0, 0.1, 200),
        }
    )
    cols = [
        {
            "id": key,
            "name": name,
            "data_type": kind,
            "missing_percent": 0,
            "distinct_count": int(frame[key].nunique()),
            "identifier": False,
        }
        for key, name, kind in [
            ("column_001", "signal", "number"),
            ("column_002", "group", "string"),
            ("column_003", "target", "string" if task == "classification" else "number"),
        ]
    ]
    config = TrainConfig(
        dataset_id=uuid4(),
        dataset_version_id=uuid4(),
        task_type=task,
        target_column="column_003",
        feature_columns=["column_001", "column_002"],
        algorithm=algorithm,
        independent_rows=True,
        n_estimators=20,
    )
    return frame, cols, config


@pytest.mark.parametrize(
    "task,algorithm",
    [
        ("classification", "logistic_regression"),
        ("classification", "random_forest_classifier"),
        ("regression", "ridge"),
        ("regression", "random_forest_regressor"),
    ],
)
def test_real_heldout_models_and_saved_pipeline(task, algorithm):
    frame, cols, config = fixture(task, algorithm)
    pipeline, evaluation = ml.train(frame, cols, config, "a" * 64)
    x, y, train, test, _, _ = ml.prepare(frame, cols, config)
    predicted = pipeline.predict(x.iloc[test])
    metric = "accuracy" if task == "classification" else "mae"
    expected = (
        accuracy_score(y.iloc[test], predicted)
        if task == "classification"
        else mean_absolute_error(y.iloc[test], predicted)
    )
    assert evaluation["metrics"][metric] == pytest.approx(expected)
    assert evaluation["train_rows"] == 160 and evaluation["test_rows"] == 40
    assert set(train).isdisjoint(test)
    restored = joblib.load(BytesIO(ml.serialize(pipeline)))
    output = ml.predict(restored, evaluation["inputs"], {"column_001": 0.5, "column_002": "unseen"})
    assert output["prediction"] is not None
    assert len(evaluation["explanation"]["features"]) > 0


def test_preprocessing_statistics_and_categories_only_use_training_rows():
    frame, cols, config = fixture()
    _, _, train, test, _, _ = ml.prepare(frame, cols, config)
    frame.loc[test, "column_001"] = 100000
    frame.loc[test, "column_002"] = "test-only"
    frame.loc[train[:5], "column_001"] = np.nan
    pipeline, _ = ml.train(frame, cols, config, "b" * 64)
    transformer = pipeline.named_steps["preprocess"]
    numeric = transformer.named_transformers_["numeric"]
    assert numeric.named_steps["impute"].statistics_[0] == pytest.approx(
        frame.iloc[train]["column_001"].median()
    )
    assert numeric.named_steps["scale"].mean_[0] < 2
    assert (
        "test-only"
        not in transformer.named_transformers_["categorical"].named_steps["encode"].categories_[0]
    )


def test_invalid_targets_tiny_data_and_prediction_types():
    frame, cols, config = fixture()
    with pytest.raises(AppError):
        ml.prepare(frame.head(6), cols, config)
    frame["column_003"] = "one"
    with pytest.raises(AppError):
        ml.prepare(frame, cols, config)
    frame, cols, config = fixture("regression", "ridge")
    config = config.model_copy(
        update={"target_column": "column_002", "feature_columns": ["column_001"]}
    )
    with pytest.raises(AppError):
        ml.prepare(frame, cols, config)
    frame, cols, config = fixture("regression", "ridge")
    config = config.model_copy(
        update={"task_type": "classification", "algorithm": "logistic_regression"}
    )
    with pytest.raises(AppError):
        ml.prepare(frame, cols, config)


def test_multiclass_metrics_and_stratified_support():
    frame, cols, config = fixture()
    frame["column_003"] = np.where(
        frame.column_001 < -0.4, "low", np.where(frame.column_001 > 0.4, "high", "middle")
    )
    _, result = ml.train(frame, cols, config, "c" * 64)
    assert len(result["confusion_matrix"]) == 3
    assert "f1_macro" in result["metrics"]
    assert 0 <= result["metrics"]["roc_auc"] <= 1
    assert all(row["test"] >= 1 for row in result["class_distribution"])


def test_seeded_training_is_reproducible():
    frame, cols, config = fixture("regression", "random_forest_regressor")
    config = config.model_copy(update={"random_seed": 29, "n_estimators": 20})
    _, first = ml.train(frame, cols, config, "d" * 64)
    _, second = ml.train(frame, cols, config, "d" * 64)
    assert first["split_fingerprint"] == second["split_fingerprint"]
    assert first["metrics"] == pytest.approx(second["metrics"])
