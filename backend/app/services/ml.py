"""Bounded CPU supervised learning. Only training rows fit learned transforms."""

import hashlib
import io
import math
import warnings

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    mean_absolute_error,
    precision_recall_fscore_support,
    r2_score,
    roc_auc_score,
    root_mean_squared_error,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from threadpoolctl import threadpool_limits

from app.core.errors import AppError
from app.services.ml_contracts import TrainConfig

ALGORITHMS = {
    "classification": ["logistic_regression", "random_forest_classifier"],
    "regression": ["ridge", "random_forest_regressor"],
}
MAX_MODEL_BYTES = 100_000_000


def fail(message):
    raise AppError(422, "INVALID_ML_DATA", message)


def columns_from_profile(profile):
    result = []
    for col in profile["columns"]:
        name = col["name"].lower().replace(" ", "_")
        identifier = name == "id" or name.endswith("_id") or name in {"index", "uuid", "email"}
        result.append(
            {
                key: col[key]
                for key in ("id", "name", "data_type", "missing_percent", "distinct_count")
            }
            | {"identifier": identifier}
        )
    return result


def prepare(frame, columns, config: TrainConfig):
    known = {col["id"]: col for col in columns}
    selected = [config.target_column, *config.feature_columns]
    if any(key not in known or key not in frame for key in selected):
        fail("A target or feature column does not exist in this dataset version.")
    if len(frame) > 50_000 or len(frame) * len(config.feature_columns) > 1_000_000:
        fail("ML supports at most 50,000 rows and 1,000,000 selected feature cells.")
    target = frame[config.target_column]
    mask = target.notna()
    data = frame.loc[mask].copy()
    y = data[config.target_column]
    if len(data) < 50:
        fail("At least 50 rows with nonmissing target labels are required for held-out evaluation.")
    notes = [
        "Random holdout assumes independent rows. Grouped or "
        "time-dependent data needs a different evaluation strategy."
    ]
    if len(data) < 200:
        notes.append(
            "Small dataset: held-out metrics can vary substantially and are "
            "not evidence of deployment readiness."
        )
    if (~mask).sum():
        notes.append(
            f"Excluded {int((~mask).sum())} rows with missing target labels before splitting."
        )
    if config.task_type == "regression":
        if known[config.target_column]["data_type"] not in {"integer", "number"}:
            fail("Regression requires a numeric target column.")
        y = pd.to_numeric(y, errors="coerce").astype(float)
        if not np.isfinite(y).all() or y.nunique() < 2:
            fail("Regression requires finite numeric labels with at least two distinct values.")
    else:
        if known[config.target_column]["data_type"] in {"datetime", "empty"}:
            fail("Classification requires discrete class labels, not dates or empty values.")
        if y.map(lambda value: len(str(value)) > 100).any():
            fail("Class labels must be at most 100 characters.")
        y = y.astype(str)
        counts = y.value_counts()
        if not 2 <= len(counts) <= min(20, len(y) // 5):
            fail(
                "Classification requires 2–20 discrete classes with adequate "
                "support; continuous or high-cardinality targets are unsupported."
            )
        if known[config.target_column]["data_type"] == "number":
            numeric = pd.to_numeric(y, errors="coerce")
            if not np.isfinite(numeric).all() or not (numeric % 1 == 0).all():
                fail(
                    "Continuous numeric targets require regression; encode discrete "
                    "class labels explicitly."
                )
        if counts.min() < 5:
            fail("Every class needs at least 5 labeled rows for stratified evaluation.")
        if counts.min() < 20:
            notes.append(
                "At least one class has fewer than 20 examples; per-class evaluation is uncertain."
            )
        if counts.max() / len(y) > 0.75:
            notes.append(
                "Class imbalance can make accuracy misleading; inspect macro F1 and class support."
            )
    x = pd.DataFrame(index=data.index)
    for key in config.feature_columns:
        col = known[key]
        values = data[key]
        if col["identifier"]:
            notes.append(
                f"{col['name']}: explicitly selected identifier; check that it is "
                f"available and meaningful at prediction time."
            )
        if col["data_type"] in {"datetime", "empty"}:
            fail("Date and entirely empty feature columns are unsupported. Select other features.")
        if col["data_type"] in {"integer", "number"}:
            x[key] = pd.to_numeric(values, errors="coerce").astype(float)
            if np.isinf(x[key]).any() or (values.notna() & x[key].isna()).any():
                fail("Numeric features must contain finite numbers or missing values.")
        else:
            if (
                values.dropna()
                .map(
                    lambda value: (
                        not isinstance(value, (str, int, float, bool)) or len(str(value)) > 200
                    )
                )
                .any()
            ):
                fail("Features must contain simple scalar values of at most 200 characters.")
            if values.nunique() > 100:
                fail(
                    "Categorical features support at most 100 distinct values; "
                    "exclude identifiers or free text."
                )
            x[key] = values.map(lambda value: str(value) if pd.notna(value) else np.nan).astype(
                object
            )
        if values.nunique() <= 1:
            notes.append(
                f"{col['name']}: constant or empty feature; it may provide no "
                f"predictive information."
            )
        if values.isna().mean() > 0.4:
            notes.append(
                f"{col['name']}: over 40% missing values; imputation may limit usefulness."
            )
        if values.astype(str).equals(data[config.target_column].astype(str)):
            fail(
                "A selected feature duplicates the target. Remove this target "
                "leakage before training."
            )
    if not any(x[key].nunique(dropna=True) > 1 for key in x):
        fail("Select at least one nonconstant feature with usable values.")
    if data[selected].duplicated().any():
        notes.append(
            "Repeated rows may leak across a random split. Review duplicates "
            "before relying on evaluation."
        )
    try:
        train_idx, test_idx = train_test_split(
            np.arange(len(x)),
            test_size=config.test_size,
            random_state=config.random_seed,
            stratify=y if config.task_type == "classification" else None,
        )
    except ValueError:
        fail(
            "The chosen split cannot support the class counts; choose more "
            "data or a suitable test fraction."
        )
    if len(test_idx) < 10 or len(train_idx) < 30:
        fail("The split needs at least 30 training rows and 10 held-out rows.")
    return x, y, train_idx, test_idx, notes, int((~mask).sum())


def scores(y, predicted, task):
    if task == "classification":
        output = {"accuracy": float(accuracy_score(y, predicted))}
        for average in ("macro", "weighted"):
            p, r, f, _ = precision_recall_fscore_support(
                y, predicted, average=average, zero_division=0
            )
            output.update(
                {
                    f"precision_{average}": float(p),
                    f"recall_{average}": float(r),
                    f"f1_{average}": float(f),
                }
            )
        return output
    return {
        "mae": float(mean_absolute_error(y, predicted)),
        "rmse": float(root_mean_squared_error(y, predicted)),
        "r2": float(r2_score(y, predicted)) if len(y) >= 2 and np.var(y) > 0 else None,
    }


def train(frame, columns, config, source_checksum):
    x, y, train_idx, test_idx, notes, dropped = prepare(frame, columns, config)
    numeric = [
        c["id"]
        for c in columns
        if c["id"] in config.feature_columns and c["data_type"] in {"integer", "number"}
    ]
    categorical = [key for key in config.feature_columns if key not in numeric]
    transforms = []
    if numeric:
        transforms.append(
            (
                "numeric",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric,
            )
        )
    if categorical:
        transforms.append(
            (
                "categorical",
                Pipeline(
                    [
                        (
                            "impute",
                            SimpleImputer(strategy="most_frequent", keep_empty_features=True),
                        ),
                        (
                            "encode",
                            OneHotEncoder(
                                handle_unknown="ignore", max_categories=100, sparse_output=True
                            ),
                        ),
                    ]
                ),
                categorical,
            )
        )
    forest = {
        "n_estimators": config.n_estimators,
        "max_depth": config.max_depth,
        "min_samples_leaf": 2,
        "random_state": config.random_seed,
        "n_jobs": 1,
    }
    estimators = {
        "logistic_regression": lambda: LogisticRegression(
            C=config.regularization, max_iter=1000, random_state=config.random_seed
        ),
        "ridge": lambda: Ridge(alpha=config.regularization, solver="lsqr"),
        "random_forest_classifier": lambda: RandomForestClassifier(**forest),
        "random_forest_regressor": lambda: RandomForestRegressor(**forest),
    }
    pipeline = Pipeline(
        [
            ("preprocess", ColumnTransformer(transforms, sparse_threshold=1.0)),
            ("model", estimators[config.algorithm]()),
        ]
    )
    x_train, x_test, y_train, y_test = (
        x.iloc[train_idx],
        x.iloc[test_idx],
        y.iloc[train_idx],
        y.iloc[test_idx],
    )
    if config.task_type == "regression":
        for key in numeric:
            if x_train[key].nunique() > 1 and abs(x_train[key].corr(y_train)) > 0.98:
                notes.append(
                    f"{key}: near-perfect training correlation with the target. "
                    "Check for target-derived leakage; correlation can also reflect real signal."
                )
    # No fit/fit_transform occurs before this point. All statistics and vocabularies use x_train.
    with threadpool_limits(limits=1), warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ConvergenceWarning)
        pipeline.fit(x_train, y_train)
        predicted = pipeline.predict(x_test)
    if any(issubclass(item.category, ConvergenceWarning) for item in caught):
        notes.append(
            "The optimizer reached its iteration limit; coefficients and "
            "evaluation may be unreliable."
        )
    metrics = scores(y_test, predicted, config.task_type)
    dummy = (
        DummyClassifier(strategy="most_frequent")
        if config.task_type == "classification"
        else DummyRegressor(strategy="mean")
    )
    dummy.fit(np.zeros((len(y_train), 1)), y_train)
    baseline = scores(y_test, dummy.predict(np.zeros((len(y_test), 1))), config.task_type)
    model = pipeline.named_steps["model"]
    names = pipeline.named_steps["preprocess"].get_feature_names_out()
    name_map = {c["id"]: c["name"] for c in columns}

    def readable(value):
        for key, name in name_map.items():
            value = value.replace(key, name)
        return value

    if hasattr(model, "feature_importances_"):
        importance = model.feature_importances_
        method = "Random forest impurity importance"
        limitation = (
            "Impurity importance can favor high-cardinality features and does not prove causation."
        )
    else:
        coef = np.asarray(model.coef_)
        importance = np.mean(np.abs(coef), axis=0) if coef.ndim > 1 else np.abs(coef)
        method = "Absolute coefficient magnitude (mean across classes for classification)"
        limitation = (
            "Numeric features are scaled; categorical coefficients use one-hot "
            "units. Magnitudes are model-specific and do not prove causation."
        )
    ranked = sorted(zip(names, importance, strict=True), key=lambda item: item[1], reverse=True)[
        :30
    ]
    evaluation = {
        "metrics": metrics,
        "baseline": baseline,
        "train_rows": len(train_idx),
        "test_rows": len(test_idx),
        "dropped_target_rows": dropped,
        "source_checksum": source_checksum,
        "split_fingerprint": hashlib.sha256(
            np.asarray(test_idx, dtype="<i8").tobytes()
        ).hexdigest(),
        "warnings": notes,
        "inputs": [c for key in config.feature_columns for c in columns if c["id"] == key],
        "explanation": {
            "method": method,
            "limitation": limitation,
            "features": [
                {"name": readable(str(name)), "value": float(value)} for name, value in ranked
            ],
        },
        "package_versions": {
            "scikit-learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "joblib": joblib.__version__,
        },
    }
    if config.task_type == "classification":
        labels = model.classes_
        evaluation["classes"] = labels.tolist()
        evaluation["roc_auc_method"] = (
            f"Binary ROC-AUC; positive class: {labels[1]}"
            if len(labels) == 2
            else "Multiclass one-vs-rest ROC-AUC, macro average"
        )
        evaluation["confusion_matrix"] = confusion_matrix(y_test, predicted, labels=labels).tolist()
        evaluation["class_distribution"] = [
            {
                "label": str(label),
                "train": int((y_train == label).sum()),
                "test": int((y_test == label).sum()),
            }
            for label in labels
        ]
        if set(predicted) != set(labels):
            notes.append(
                "One or more classes have no predicted examples; undefined "
                "precision is reported as zero."
            )
        try:
            probabilities = pipeline.predict_proba(x_test)
            metrics["roc_auc"] = float(
                roc_auc_score(
                    y_test,
                    probabilities[:, 1] if len(labels) == 2 else probabilities,
                    **(
                        {}
                        if len(labels) == 2
                        else {"multi_class": "ovr", "average": "macro", "labels": labels}
                    ),
                )
            )
        except ValueError:
            metrics["roc_auc"] = None
            notes.append("ROC-AUC is undefined for this held-out class distribution.")
    else:
        residual = np.asarray(y_test) - predicted
        evaluation["actual_predicted"] = [
            {"actual": float(a), "predicted": float(p), "residual": float(a - p)}
            for a, p in zip(y_test.iloc[:200], predicted[:200], strict=True)
        ]
        evaluation["residual_summary"] = {
            "mean": float(residual.mean()),
            "stddev": float(residual.std()),
            "min": float(residual.min()),
            "max": float(residual.max()),
        }
        if metrics["r2"] is None:
            notes.append("R² is undefined because the held-out target has zero variance.")
    for group in (metrics, baseline):
        if any(v is not None and not math.isfinite(v) for v in group.values()):
            fail("Evaluation overflowed; rescale extreme numeric values before training.")
    return pipeline, evaluation


def serialize(pipeline):
    stream = io.BytesIO()
    joblib.dump(pipeline, stream, compress=3)
    data = stream.getvalue()
    if len(data) > MAX_MODEL_BYTES:
        fail("The fitted model exceeds the 100 MB artifact limit.")
    return data


def predict(pipeline, inputs, values):
    if set(values) != {col["id"] for col in inputs}:
        fail("Supply every expected feature field, using null for an intentionally missing value.")
    normalized = {}
    for col in inputs:
        value = values[col["id"]]
        if value is None:
            normalized[col["id"]] = np.nan
        elif col["data_type"] in {"integer", "number"}:
            if isinstance(value, (str, bool)) or not math.isfinite(value):
                fail("Numeric prediction inputs must be finite numbers or null.")
            normalized[col["id"]] = float(value)
        else:
            if not isinstance(value, (str, bool)) or len(str(value)) > 200:
                fail(
                    "Categorical prediction inputs must be strings of at most 200 "
                    "characters or null."
                )
            normalized[col["id"]] = str(value)
    frame = pd.DataFrame([normalized])
    with threadpool_limits(limits=1):
        value = pipeline.predict(frame)[0]
        probabilities = (
            {
                str(key): float(p)
                for key, p in zip(pipeline.classes_, pipeline.predict_proba(frame)[0], strict=True)
            }
            if hasattr(pipeline, "predict_proba")
            else None
        )
    output = str(value) if probabilities is not None else float(value)
    if isinstance(output, float) and not math.isfinite(output):
        fail("Prediction is not finite; review input values.")
    return {
        "prediction": output,
        "probabilities": probabilities,
        "note": "Model estimate, not a guaranteed real-world outcome. "
        "Unseen categories are safely encoded as zero.",
    }


def load_source(db, settings, owner_id, version_id, dataset_id=None):
    """Recheck lineage, bounds and checksum before reading an immutable source."""
    from sqlalchemy import select

    from app.db.models import Dataset, DatasetProfile, DatasetVersion, StoredArtifact
    from app.services.cleaning import read_frame
    from app.storage.paths import ArtifactStore

    version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.id == version_id, DatasetVersion.owner_id == owner_id
        )
    )
    if version is None or (dataset_id is not None and version.dataset_id != dataset_id):
        raise AppError(404, "VERSION_NOT_FOUND", "Dataset version not found.")
    dataset = db.scalar(
        select(Dataset).where(Dataset.id == version.dataset_id, Dataset.owner_id == owner_id)
    )
    artifact = db.scalar(
        select(StoredArtifact).where(
            StoredArtifact.id == version.artifact_id, StoredArtifact.owner_id == owner_id
        )
    )
    profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == version_id)
    )
    if not dataset or not artifact or not profile:
        raise AppError(409, "SOURCE_UNAVAILABLE", "A completed, owned dataset profile is required.")
    if profile.row_count > 50_000:
        fail("ML supports at most 50,000 rows per dataset version.")
    try:
        path = ArtifactStore(settings.file_storage_root).resolve(artifact.relative_path)
        if (
            path.stat().st_size > settings.max_upload_bytes
            or path.stat().st_size != artifact.size_bytes
        ):
            raise ValueError("size")
        with path.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        if checksum != artifact.sha256:
            raise ValueError("checksum")
    except (OSError, ValueError):
        raise AppError(
            409, "ARTIFACT_UNAVAILABLE", "Source artifact failed integrity verification."
        ) from None
    frame, _ = read_frame(
        path,
        "xlsx" if artifact.mime_type.endswith("spreadsheetml.sheet") else "csv",
        dataset.selected_sheet if version.version_no == 1 else None,
        settings.max_dataset_columns,
        50_000,
    )
    return frame, columns_from_profile(profile.profile_json), artifact.sha256
