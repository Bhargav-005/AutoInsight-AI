"""Allowlisted ML contracts shared by the API and worker."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TrainConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    dataset_id: UUID
    dataset_version_id: UUID
    task_type: Literal["classification", "regression"]
    target_column: str = Field(pattern=r"^column_[0-9]{3}$")
    feature_columns: list[str] = Field(min_length=1, max_length=30)
    algorithm: Literal[
        "logistic_regression", "random_forest_classifier", "ridge", "random_forest_regressor"
    ]
    test_size: float = Field(default=0.2, ge=0.2, le=0.4)
    random_seed: int = Field(default=42, ge=0, le=2147483647)
    regularization: float = Field(default=1, ge=0.01, le=100)
    n_estimators: int = Field(default=100, ge=20, le=200)
    max_depth: int = Field(default=10, ge=2, le=16)
    independent_rows: Literal[True]

    @model_validator(mode="after")
    def validate_selection(self):
        allowed = {
            "classification": {"logistic_regression", "random_forest_classifier"},
            "regression": {"ridge", "random_forest_regressor"},
        }
        if self.algorithm not in allowed[self.task_type]:
            raise ValueError("Algorithm must match the explicitly selected task")
        if self.target_column in self.feature_columns or len(set(self.feature_columns)) != len(
            self.feature_columns
        ):
            raise ValueError("Features must be distinct and must exclude the target")
        return self


class MLColumn(BaseModel):
    id: str
    name: str
    data_type: str
    missing_percent: float
    distinct_count: int
    identifier: bool


class MetadataView(BaseModel):
    dataset_id: UUID
    dataset_version_id: UUID
    row_count: int
    columns: list[MLColumn]
    warnings: list[str]
    algorithms: dict[str, list[str]]
    minimum_rows: int = 50
    maximum_rows: int = 50000


class Explanation(BaseModel):
    method: str
    limitation: str
    features: list[dict[str, str | float]]


class Evaluation(BaseModel):
    metrics: dict[str, float | None]
    baseline: dict[str, float | None]
    train_rows: int
    test_rows: int
    dropped_target_rows: int
    split_fingerprint: str
    source_checksum: str
    warnings: list[str]
    inputs: list[MLColumn]
    classes: list[str] = []
    roc_auc_method: str | None = None
    class_distribution: list[dict] = []
    confusion_matrix: list[list[int]] = []
    actual_predicted: list[dict[str, float]] = []
    residual_summary: dict[str, float] = {}
    explanation: Explanation
    package_versions: dict[str, str]


class RunView(BaseModel):
    id: UUID
    dataset_version_id: UUID
    task_type: str
    target_column: str
    status: str
    config: TrainConfig
    job_id: str | None
    attempt_count: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    evaluation: Evaluation | None
    model_available: bool


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_ids: list[UUID] = Field(min_length=2, max_length=5)


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    values: dict[str, str | float | bool | None] = Field(min_length=1, max_length=30)


class PredictionView(BaseModel):
    id: UUID
    ml_run_id: UUID
    created_at: datetime
    prediction: str | float
    probabilities: dict[str, float] | None
    note: str
