"""Owner-scoped cleaning plans and deterministic dataset analytics."""

import hashlib
import math
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import DB, CurrentUser, Envelope, result
from app.core.errors import AppError
from app.core.security import require_csrf
from app.db.models import CleaningPlan, Dataset, DatasetProfile, DatasetVersion, StoredArtifact
from app.services import analytics
from app.services.cleaning import apply_operations, read_frame
from app.services.cleaning import preview as make_preview
from app.services.profiling import DatasetFileError
from app.storage.paths import ArtifactStore
from worker.connection import queue

router = APIRouter(prefix="/api/v1", tags=["cleaning and analytics"])


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal[
        "drop_duplicates",
        "drop_missing_rows",
        "fill_missing",
        "trim_whitespace",
        "replace_text",
        "cast_numeric",
    ]
    column: str | None = Field(default=None, pattern=r"^column_[0-9]{3}$")
    columns: list[str] | None = Field(default=None, min_length=1, max_length=100)
    keep: Literal["first", "last"] = "first"
    strategy: Literal["constant", "mode", "mean", "median"] | None = None
    value: str | int | float | None = None
    find: str | None = Field(default=None, max_length=200)
    replace: str | None = Field(default=None, max_length=200)
    invalid: Literal["coerce", "error"] = "error"

    @model_validator(mode="after")
    def valid_fields(self):
        if isinstance(self.value, str) and len(self.value) > 200:
            raise ValueError("Constant replacement values must be at most 200 characters")
        if isinstance(self.value, float) and not math.isfinite(self.value):
            raise ValueError("Numeric replacement values must be finite")
        if (
            self.op in {"fill_missing", "trim_whitespace", "replace_text", "cast_numeric"}
            and not self.column
        ):
            raise ValueError("This operation requires a column")
        if self.op == "fill_missing" and self.strategy is None:
            raise ValueError("Fill operation requires a strategy")
        if self.op == "fill_missing" and self.strategy == "constant" and self.value is None:
            raise ValueError("Constant fill requires a value")
        if self.op == "replace_text" and (self.find is None or self.replace is None):
            raise ValueError("Text replacement requires find and replace values")
        if self.columns is not None and len(set(self.columns)) != len(self.columns):
            raise ValueError("Selected columns must be unique")
        return self


class PlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_version_id: UUID
    operations: list[Operation] = Field(min_length=1, max_length=20)


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_apply: bool


class GroupedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_id: UUID
    group_by: list[str] = Field(min_length=1, max_length=2)
    operation: Literal["count", "sum", "mean", "min", "max", "median"]
    column: str | None = None

    @field_validator("group_by")
    @classmethod
    def unique_groups(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Group columns must be unique")
        return values


class ColumnsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_id: UUID
    columns: list[str] | None = Field(default=None, max_length=20)

    @field_validator("columns")
    @classmethod
    def unique_columns(cls, values):
        if values is not None and len(set(values)) != len(values):
            raise ValueError("Selected columns must be unique")
        return values


class ChartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_id: UUID
    chart_type: Literal["bar", "line", "scatter", "histogram", "category"]
    x: str = Field(pattern=r"^column_[0-9]{3}$")
    y: str | None = Field(default=None, pattern=r"^column_[0-9]{3}$")

    @model_validator(mode="after")
    def distinct_scatter_columns(self):
        if self.chart_type == "scatter" and self.x == self.y:
            raise ValueError("Scatter plots require two distinct columns")
        return self


class PlanView(BaseModel):
    id: UUID
    dataset_version_id: UUID
    state: str
    operations: list[Operation]
    preview: "PlanPreviewView | None" = None
    job_id: str | None = None
    attempt_count: int
    result_version_id: UUID | None = None
    error_message: str | None = None


class PlanPreviewView(BaseModel):
    source_rows: int
    result_rows: int
    rows_removed: int
    operations: list[dict]
    source_missing_cells: int
    result_missing_cells: int
    source_duplicate_rows: int
    result_duplicate_rows: int
    before: list[dict[str, str | int | float | bool | None]]
    after: list[dict[str, str | int | float | bool | None]]
    warnings: list[str]


class SuggestionsView(BaseModel):
    dataset_id: str
    dataset_version_id: str
    missing_cells: int
    duplicate_rows: int
    operations: list[dict]
    notes: list[str]


class AnalyticsColumn(BaseModel):
    id: str
    name: str
    null_count: int
    null_percent: float
    distinct_count: int
    exact: bool
    numeric: "NumericStatistics | None"
    frequencies: list["CategoryFrequency"] | None
    frequency_warning: str | None = None


class NumericStatistics(BaseModel):
    count: int
    mean: float | None
    median: float | None
    min: float | None
    max: float | None
    stddev: float | None
    histogram: list[dict[str, float | int]]


class CategoryFrequency(BaseModel):
    value: str
    count: int


class SummaryView(BaseModel):
    dataset_id: str
    dataset_version_id: str
    operation: str
    selected_columns: list[str]
    filters: list[dict]
    grouping: list[str]
    rows_analyzed: int
    exact: bool
    warnings: list[str]
    row_count: int
    column_count: int
    duplicate_rows: int
    columns: list[AnalyticsColumn]


class GroupedView(BaseModel):
    dataset_id: str
    dataset_version_id: str
    operation: str
    selected_columns: list[str]
    grouping: list[str]
    filters: list[dict]
    rows_analyzed: int
    exact: bool
    warnings: list[str]
    rows: list[dict[str, str | int | float | None]]


class CorrelationView(BaseModel):
    dataset_id: str
    dataset_version_id: str
    operation: str
    selected_columns: list[str]
    grouping: list[str]
    filters: list[dict]
    rows_analyzed: int
    exact: bool
    warnings: list[str]
    columns: list[str]
    matrix: list[dict[str, list[float | None] | str]]


class CompareVersionView(BaseModel):
    id: str
    version_no: int
    rows: int
    columns: int


class ColumnComparisonView(BaseModel):
    column_id: str
    name: str
    left_missing: int | None
    right_missing: int
    missing_delta: int | None
    left_distinct: int | None
    right_distinct: int


class CompareView(BaseModel):
    dataset_id: str
    left: CompareVersionView
    right: CompareVersionView
    column_comparisons: list[ColumnComparisonView]
    note: str


class ChartView(GroupedView):
    pass


def _owned(db: Session, owner_id: UUID, dataset_id: UUID, version_id: UUID):
    dataset = db.scalar(
        select(Dataset).where(Dataset.id == dataset_id, Dataset.owner_id == owner_id)
    )
    if dataset is None:
        raise AppError(404, "DATASET_NOT_FOUND", "Dataset not found.")
    version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.id == version_id,
            DatasetVersion.dataset_id == dataset.id,
            DatasetVersion.owner_id == owner_id,
        )
    )
    if version is None:
        raise AppError(404, "VERSION_NOT_FOUND", "Dataset version not found.")
    artifact = db.scalar(
        select(StoredArtifact).where(
            StoredArtifact.id == version.artifact_id, StoredArtifact.owner_id == owner_id
        )
    )
    if artifact is None:
        raise AppError(404, "VERSION_NOT_FOUND", "Dataset version not found.")
    return dataset, version, artifact


def _frame(request: Request, dataset, version, artifact):
    settings = request.app.state.settings
    try:
        path = ArtifactStore(Path(settings.file_storage_root)).resolve(artifact.relative_path)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while block := source.read(1024 * 1024):
                digest.update(block)
    except (OSError, ValueError):
        raise AppError(
            409, "ARTIFACT_UNAVAILABLE", "The selected dataset version is unavailable."
        ) from None
    if digest.hexdigest() != artifact.sha256:
        raise AppError(
            409,
            "ARTIFACT_CHECKSUM_MISMATCH",
            "The stored dataset version failed integrity verification.",
        )
    source_format = "xlsx" if artifact.mime_type.endswith("spreadsheetml.sheet") else "csv"
    try:
        frame, headers = read_frame(
            path,
            source_format,
            dataset.selected_sheet if version.version_no == 1 else None,
            settings.max_dataset_columns,
            settings.max_dataset_rows,
        )
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    if len(frame) > settings.max_dataset_rows:
        raise AppError(
            422, "DATASET_LIMIT_EXCEEDED", "The dataset exceeds the row processing limit."
        )
    return frame, headers


def _plan_view(plan: CleaningPlan):
    return {
        "id": plan.id,
        "dataset_version_id": plan.dataset_version_id,
        "state": plan.state,
        "operations": plan.operations_json,
        "preview": plan.preview_json,
        "job_id": plan.job_id,
        "attempt_count": plan.attempt_count,
        "result_version_id": plan.result_version_id,
        "error_message": plan.error_message,
    }


@router.get(
    "/datasets/{dataset_id}/versions/{version_id}/cleaning/suggestions",
    response_model=Envelope[SuggestionsView],
)
def suggestions(request: Request, dataset_id: UUID, version_id: UUID, user: CurrentUser, db: DB):
    _, version, _ = _owned(db, user.id, dataset_id, version_id)
    profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == version.id)
    )
    if profile is None:
        raise AppError(409, "PROFILE_UNAVAILABLE", "The selected version has no completed profile.")
    profile_data = profile.profile_json
    operations = []
    for column in profile_data["columns"]:
        if column["missing_count"]:
            operations.append({"op": "fill_missing", "column": column["id"], "strategy": "mode"})
    if profile_data.get("duplicate_row_count", 0):
        operations.insert(0, {"op": "drop_duplicates"})
    return result(
        request,
        {
            "dataset_id": str(dataset_id),
            "dataset_version_id": str(version_id),
            "missing_cells": profile_data["quality_summary"]["missing_cell_count"],
            "duplicate_rows": profile_data.get("duplicate_row_count", 0),
            "operations": operations[:20],
            "notes": [
                "Suggestions come from this version's profile; review and edit before previewing."
            ],
        },
    )


@router.post(
    "/datasets/{dataset_id}/cleaning/plans",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[PlanView],
)
def create_plan(request: Request, dataset_id: UUID, payload: PlanCreate, user: CurrentUser, db: DB):
    _, version, _ = _owned(db, user.id, dataset_id, payload.dataset_version_id)
    if (
        db.scalar(select(DatasetProfile.id).where(DatasetProfile.dataset_version_id == version.id))
        is None
    ):
        raise AppError(409, "PROFILE_UNAVAILABLE", "The selected version has no completed profile.")
    plan = CleaningPlan(
        owner_id=user.id,
        dataset_version_id=version.id,
        state="draft",
        operations_json=[item.model_dump(exclude_none=True) for item in payload.operations],
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return result(request, _plan_view(plan))


@router.get("/cleaning/plans/{plan_id}", response_model=Envelope[PlanView])
def get_plan(request: Request, plan_id: UUID, user: CurrentUser, db: DB):
    plan = db.scalar(
        select(CleaningPlan).where(CleaningPlan.id == plan_id, CleaningPlan.owner_id == user.id)
    )
    if plan is None:
        raise AppError(404, "CLEANING_PLAN_NOT_FOUND", "Cleaning plan not found.")
    return result(request, _plan_view(plan))


@router.post(
    "/cleaning/plans/{plan_id}/preview",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[PlanView],
)
def preview_plan(request: Request, plan_id: UUID, user: CurrentUser, db: DB):
    plan = db.scalar(
        select(CleaningPlan)
        .where(CleaningPlan.id == plan_id, CleaningPlan.owner_id == user.id)
        .with_for_update()
    )
    if plan is None:
        raise AppError(404, "CLEANING_PLAN_NOT_FOUND", "Cleaning plan not found.")
    if plan.state not in {"draft", "previewed"}:
        raise AppError(409, "PLAN_NOT_PREVIEWABLE", "Only an unapproved plan can be previewed.")
    dataset = db.scalar(
        select(Dataset).where(
            Dataset.owner_id == user.id,
            Dataset.id
            == db.scalar(
                select(DatasetVersion.dataset_id).where(
                    DatasetVersion.id == plan.dataset_version_id
                )
            ),
        )
    )
    if dataset is None:
        raise AppError(404, "DATASET_NOT_FOUND", "Dataset not found.")
    _, version, artifact = _owned(db, user.id, dataset.id, plan.dataset_version_id)
    frame, headers = _frame(request, dataset, version, artifact)
    try:
        cleaned, details = apply_operations(frame, plan.operations_json)
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    plan.preview_json = make_preview(frame, cleaned, details, headers)
    plan.state = "previewed"
    plan.error_message = None
    db.commit()
    db.refresh(plan)
    return result(request, _plan_view(plan))


def _enqueue(request: Request, plan: CleaningPlan):
    settings = request.app.state.settings
    redis = request.app.state.redis
    if redis is None:
        raise RuntimeError("queue unavailable")
    queue(settings, redis).enqueue(
        "worker.jobs.apply_cleaning_plan",
        str(plan.id),
        plan.attempt_count,
        job_id=plan.job_id,
        job_timeout=min(settings.max_job_seconds, 600),
        result_ttl=3600,
        failure_ttl=86400,
    )


@router.post(
    "/cleaning/plans/{plan_id}/approve",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[PlanView],
)
def approve_plan(request: Request, plan_id: UUID, payload: Approval, user: CurrentUser, db: DB):
    plan = db.scalar(
        select(CleaningPlan)
        .where(CleaningPlan.id == plan_id, CleaningPlan.owner_id == user.id)
        .with_for_update()
    )
    if plan is None:
        raise AppError(404, "CLEANING_PLAN_NOT_FOUND", "Cleaning plan not found.")
    if plan.state != "previewed" or plan.preview_json is None:
        raise AppError(409, "PLAN_NOT_PREVIEWED", "Preview this plan before approving it.")
    if not payload.confirm_apply:
        raise AppError(
            422, "APPROVAL_REQUIRED", "Explicit approval is required to apply this plan."
        )
    plan.state = "queued"
    plan.approved_by = user.id
    plan.attempt_count += 1
    plan.job_id = f"clean-{plan.id}-{plan.attempt_count}"
    plan.error_message = None
    db.commit()
    try:
        _enqueue(request, plan)
    except Exception:
        plan.state = "failed"
        plan.error_message = "The cleaning queue is unavailable. Retry the approved plan."
        db.commit()
        raise AppError(503, "QUEUE_UNAVAILABLE", plan.error_message) from None
    return result(request, _plan_view(plan))


@router.post(
    "/cleaning/plans/{plan_id}/retry",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[PlanView],
)
def retry_plan(request: Request, plan_id: UUID, user: CurrentUser, db: DB):
    plan = db.scalar(
        select(CleaningPlan)
        .where(CleaningPlan.id == plan_id, CleaningPlan.owner_id == user.id)
        .with_for_update()
    )
    if plan is None:
        raise AppError(404, "CLEANING_PLAN_NOT_FOUND", "Cleaning plan not found.")
    if plan.state != "failed" or plan.approved_by != user.id:
        raise AppError(
            409, "PLAN_NOT_RETRYABLE", "Only a previously approved failed plan can be retried."
        )
    plan.state = "queued"
    plan.attempt_count += 1
    plan.job_id = f"clean-{plan.id}-{plan.attempt_count}"
    plan.error_message = None
    db.commit()
    try:
        _enqueue(request, plan)
    except Exception:
        plan.state = "failed"
        plan.error_message = "The cleaning queue is unavailable. Retry the approved plan."
        db.commit()
        raise AppError(503, "QUEUE_UNAVAILABLE", plan.error_message) from None
    return result(request, _plan_view(plan))


@router.get("/datasets/{dataset_id}/compare", response_model=Envelope[CompareView])
def compare_versions(
    request: Request,
    dataset_id: UUID,
    left_version_id: UUID,
    right_version_id: UUID,
    user: CurrentUser,
    db: DB,
):
    _, left, _ = _owned(db, user.id, dataset_id, left_version_id)
    _, right, _ = _owned(db, user.id, dataset_id, right_version_id)
    left_profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == left.id)
    )
    right_profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == right.id)
    )
    if left_profile is None or right_profile is None:
        raise AppError(
            409, "PROFILE_UNAVAILABLE", "Both versions need completed profiles before comparison."
        )
    columns = {column["id"]: column for column in left_profile.profile_json["columns"]}
    comparisons = []
    for column in right_profile.profile_json["columns"]:
        before = columns.get(column["id"])
        comparisons.append(
            {
                "column_id": column["id"],
                "name": column["name"],
                "left_missing": before["missing_count"] if before else None,
                "right_missing": column["missing_count"],
                "missing_delta": column["missing_count"] - before["missing_count"]
                if before
                else None,
                "left_distinct": before["distinct_count"] if before else None,
                "right_distinct": column["distinct_count"],
            }
        )
    return result(
        request,
        {
            "dataset_id": str(dataset_id),
            "left": {
                "id": str(left.id),
                "version_no": left.version_no,
                "rows": left_profile.row_count,
                "columns": left_profile.column_count,
            },
            "right": {
                "id": str(right.id),
                "version_no": right.version_no,
                "rows": right_profile.row_count,
                "columns": right_profile.column_count,
            },
            "column_comparisons": comparisons,
            "note": (
                "Compares exact profile counts for each immutable version; "
                "source artifacts are unchanged."
            ),
        },
    )


def _analytics_frame(request, db, user, dataset_id, version_id):
    dataset, version, artifact = _owned(db, user.id, dataset_id, version_id)
    frame, headers = _frame(request, dataset, version, artifact)
    return dataset, version, frame, headers


@router.get("/datasets/{dataset_id}/analytics/summary", response_model=Envelope[SummaryView])
def analytics_summary(
    request: Request, dataset_id: UUID, version_id: UUID, user: CurrentUser, db: DB
):
    _, version, frame, headers = _analytics_frame(request, db, user, dataset_id, version_id)
    try:
        summary = analytics.summarize(frame, headers, str(dataset_id), str(version.id))
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    return result(request, summary)


@router.post(
    "/datasets/{dataset_id}/analytics/grouped",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[GroupedView],
)
def analytics_grouped(
    request: Request, dataset_id: UUID, payload: GroupedRequest, user: CurrentUser, db: DB
):
    _, version, frame, _ = _analytics_frame(request, db, user, dataset_id, payload.version_id)
    try:
        rows, warnings = analytics.grouped(
            frame, payload.group_by, payload.operation, payload.column
        )
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    return result(
        request,
        {
            "dataset_id": str(dataset_id),
            "dataset_version_id": str(version.id),
            "operation": payload.operation,
            "selected_columns": payload.group_by + ([payload.column] if payload.column else []),
            "grouping": payload.group_by,
            "filters": [],
            "rows_analyzed": len(frame),
            "exact": True,
            "warnings": warnings,
            "rows": rows,
        },
    )


@router.post(
    "/datasets/{dataset_id}/analytics/correlation",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[CorrelationView],
)
def analytics_correlation(
    request: Request, dataset_id: UUID, payload: ColumnsRequest, user: CurrentUser, db: DB
):
    _, version, frame, _ = _analytics_frame(request, db, user, dataset_id, payload.version_id)
    try:
        matrix = analytics.correlation(frame, payload.columns)
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    return result(
        request,
        {
            "dataset_id": str(dataset_id),
            "dataset_version_id": str(version.id),
            "operation": "pearson_correlation",
            "selected_columns": matrix["columns"],
            "grouping": [],
            "filters": [],
            "rows_analyzed": len(frame),
            "exact": True,
            "warnings": matrix["warnings"],
            **matrix,
        },
    )


@router.post(
    "/datasets/{dataset_id}/analytics/chart",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[ChartView],
)
def analytics_chart(
    request: Request, dataset_id: UUID, payload: ChartRequest, user: CurrentUser, db: DB
):
    _, version, frame, _ = _analytics_frame(request, db, user, dataset_id, payload.version_id)
    try:
        rows, columns, warnings = analytics.chart_data(
            frame, payload.chart_type, payload.x, payload.y
        )
    except DatasetFileError as exc:
        raise AppError(422, exc.code, str(exc)) from None
    return result(
        request,
        {
            "dataset_id": str(dataset_id),
            "dataset_version_id": str(version.id),
            "operation": payload.chart_type,
            "selected_columns": columns,
            "grouping": [payload.x] if payload.chart_type in {"bar", "line"} else [],
            "filters": [],
            "rows_analyzed": len(frame),
            "exact": True,
            "warnings": warnings,
            "rows": rows,
        },
    )
