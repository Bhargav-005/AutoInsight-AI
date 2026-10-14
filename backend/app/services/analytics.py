"""Deterministic analytics over a selected, owner-authorized dataset version."""

import math
import statistics

import numpy as np
import pandas as pd

from app.services.profiling import DatasetFileError

MAX_RESULT_ROWS = 100
MAX_METRICS = 10
MAX_CATEGORY_VALUES = 50
MAX_CORRELATION_COLUMNS = 20


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame:
        raise DatasetFileError("INVALID_COLUMN", "A selected column is unavailable.")
    return (
        pd.to_numeric(frame[column], errors="coerce")
        .replace([float("inf"), -float("inf")], pd.NA)
        .dropna()
    )


def numeric_columns(frame: pd.DataFrame) -> list[str]:
    return [column for column in frame.columns if len(_numeric(frame, column)) > 0]


def summarize(frame: pd.DataFrame, headers: list[str], dataset_id: str, version_id: str):
    columns = []
    warnings = []
    for index, key in enumerate(frame.columns):
        series = frame[key]
        valid = series.dropna()
        numeric = _numeric(frame, key)
        item = {
            "id": key,
            "name": headers[index],
            "null_count": int(series.isna().sum()),
            "null_percent": float(series.isna().mean() * 100) if len(frame) else 0.0,
            "distinct_count": int(valid.nunique(dropna=True)),
            "exact": True,
        }
        if not numeric.empty:
            histogram = _histogram(numeric)
            numeric_values = [float(value) for value in numeric]
            ordered_values = sorted(numeric_values)
            middle = len(ordered_values) // 2
            median = (
                ordered_values[middle]
                if len(ordered_values) % 2
                else ordered_values[middle - 1] / 2 + ordered_values[middle] / 2
            )
            raw_statistics = {
                "mean": math.fsum(value / len(numeric_values) for value in numeric_values),
                "median": median,
                "min": min(numeric_values),
                "max": max(numeric_values),
                "stddev": statistics.stdev(numeric_values) if len(numeric_values) >= 2 else None,
            }
            statistic_values = {
                key: _finite_or_none(value) if value is not None else None
                for key, value in raw_statistics.items()
            }
            overflowed = any(
                value is not None and not math.isfinite(float(value))
                for value in raw_statistics.values()
            )
            if overflowed or not histogram:
                warnings.append(
                    f"Some statistics for {headers[index]} were omitted because "
                    "of numeric overflow."
                )
            item["numeric"] = {
                "count": int(len(numeric)),
                **statistic_values,
                "histogram": histogram,
            }
            item["frequencies"] = None
        else:
            frequencies = valid.astype(str).value_counts(dropna=False)
            item["numeric"] = None
            item["frequencies"] = [
                {"value": str(value)[:200], "count": int(count)}
                for value, count in frequencies.head(MAX_CATEGORY_VALUES).items()
            ]
            if len(frequencies) > MAX_CATEGORY_VALUES:
                item["frequency_warning"] = (
                    f"Showing the {MAX_CATEGORY_VALUES} most frequent values of "
                    f"{len(frequencies)}; counts use all rows."
                )
        columns.append(item)
    return {
        "dataset_id": dataset_id,
        "dataset_version_id": version_id,
        "operation": "descriptive_summary",
        "selected_columns": list(frame.columns),
        "filters": [],
        "grouping": [],
        "rows_analyzed": int(len(frame)),
        "exact": True,
        "warnings": warnings,
        "row_count": int(len(frame)),
        "column_count": int(len(frame.columns)),
        "duplicate_rows": int(frame.duplicated().sum()),
        "columns": columns,
    }


def _histogram(values: pd.Series, bins: int = 10):
    if values.empty:
        return []
    low, high = float(values.min()), float(values.max())
    if low == high:
        return [{"start": low, "end": high, "count": int(len(values))}]
    if not math.isfinite(high - low):
        return []
    counts, edges = np.histogram(values.to_numpy(dtype="float64"), bins=bins)
    return [
        {"start": float(edges[index]), "end": float(edges[index + 1]), "count": int(count)}
        for index, count in enumerate(counts)
    ]


def grouped(frame, groups: list[str], operation: str, metric: str | None):
    if not groups or len(groups) > 2 or any(column not in frame for column in groups):
        raise DatasetFileError("INVALID_GROUPING", "Select one or two available group columns.")
    if operation not in {"count", "sum", "mean", "min", "max", "median"}:
        raise DatasetFileError("INVALID_OPERATION", "The aggregate operation is unsupported.")
    if operation == "count" and metric is None:
        result = frame.groupby(groups, dropna=False, observed=True).size().rename("value")
    elif operation == "count" and metric in frame:
        # Count nonmissing values regardless of their type; do not coerce text to NaN.
        result = frame.groupby(groups, dropna=False, observed=True)[metric].count().rename("value")
    else:
        if metric not in frame:
            raise DatasetFileError("INVALID_COLUMN", "Select an available metric column.")
        values = _numeric(frame, metric)
        if operation not in {"count"} and values.empty:
            raise DatasetFileError("INVALID_TYPE", "This aggregate requires numeric values.")
        typed = frame.copy()
        typed[metric] = pd.to_numeric(typed[metric], errors="coerce").replace(
            [float("inf"), -float("inf")], pd.NA
        )
        metric_groups = typed.groupby(groups, dropna=False, observed=True)[metric]
        valid_counts = metric_groups.count()
        if operation == "count":
            result = metric_groups.count().rename("value")
        elif operation == "sum":
            result = metric_groups.sum(min_count=1).rename("value")
        else:
            result = getattr(metric_groups, operation)().rename("value")
    rows = []
    for key, value in result.items():
        if isinstance(value, (float, np.floating)) and not math.isfinite(float(value)):
            if pd.isna(value) and valid_counts.loc[key] == 0:
                value = None
            else:
                raise DatasetFileError(
                    "NUMERIC_OVERFLOW", "The aggregate exceeds the supported numeric range."
                )
        keys = key if isinstance(key, tuple) else (key,)
        rows.append(
            {
                **{column: _scalar(item) for column, item in zip(groups, keys, strict=True)},
                "value": _scalar(value),
            }
        )
    warnings = []
    if len(rows) > MAX_RESULT_ROWS:
        rows = sorted(rows, key=lambda row: (row["value"] is None, -(row["value"] or 0)))[
            :MAX_RESULT_ROWS
        ]
        warnings.append(
            f"Showing {MAX_RESULT_ROWS} of {len(result)} groups; aggregate was "
            "computed on all rows."
        )
    return rows, warnings


def correlation(frame: pd.DataFrame, columns: list[str] | None = None):
    selected = columns or numeric_columns(frame)
    if len(selected) < 2:
        raise DatasetFileError(
            "INSUFFICIENT_COLUMNS", "Correlation needs at least two numeric columns."
        )
    if len(selected) > MAX_CORRELATION_COLUMNS or any(column not in frame for column in selected):
        raise DatasetFileError(
            "INVALID_COLUMNS", f"Choose at most {MAX_CORRELATION_COLUMNS} valid columns."
        )
    numeric = pd.DataFrame({column: _numeric(frame, column) for column in selected})
    warnings = []
    matrix = []
    for left in selected:
        row = []
        for right in selected:
            paired = pd.DataFrame({"left": numeric[left], "right": numeric[right]}).dropna()
            if len(paired) < 2 or paired["left"].nunique() < 2 or paired["right"].nunique() < 2:
                row.append(None)
                if left == right:
                    warnings.append(f"{left} has insufficient or constant values for correlation.")
            else:
                value = paired["left"].corr(paired["right"])
                row.append(float(value) if math.isfinite(value) else None)
        matrix.append({"column": left, "values": row})
    return {"columns": selected, "matrix": matrix, "warnings": list(dict.fromkeys(warnings))}


def chart_data(frame, chart_type: str, x: str, y: str | None = None):
    if x not in frame or (y is not None and y not in frame):
        raise DatasetFileError("INVALID_COLUMN", "A selected chart column is unavailable.")
    warnings = []
    if chart_type == "histogram":
        values = _numeric(frame, x)
        if values.empty:
            raise DatasetFileError("INVALID_TYPE", "A histogram requires numeric values.")
        return _histogram(values), [x], warnings
    if chart_type == "category":
        counts = frame[x].fillna("(missing)").astype(str).value_counts()
        data = [
            {"label": str(key)[:200], "value": int(value)}
            for key, value in counts.head(MAX_CATEGORY_VALUES).items()
        ]
        if len(counts) > MAX_CATEGORY_VALUES:
            warnings.append(f"Showing the top {MAX_CATEGORY_VALUES} of {len(counts)} categories.")
        return data, [x], warnings
    if chart_type in {"bar", "line"}:
        if y is None:
            raise DatasetFileError("INVALID_COLUMN", "Select a numeric chart value column.")
        values = _numeric(frame, y)
        if values.empty:
            raise DatasetFileError("INVALID_TYPE", "This chart requires a numeric value column.")
        data, warnings = grouped(frame, [x], "sum", y)
        return (
            [
                {"label": row[x] if row[x] is not None else "(missing)", "value": row["value"]}
                for row in data
            ],
            [x, y],
            warnings,
        )
    if chart_type == "scatter":
        if y is None:
            raise DatasetFileError("INVALID_COLUMN", "Select two numeric chart columns.")
        left, right = _numeric(frame, x), _numeric(frame, y)
        paired = pd.DataFrame({x: left, y: right}).dropna().head(MAX_RESULT_ROWS)
        if paired.empty:
            raise DatasetFileError(
                "INVALID_TYPE", "Scatter plots require numeric values in both columns."
            )
        if len(frame.dropna(subset=[x, y])) > len(paired):
            warnings.append(
                f"Showing {MAX_RESULT_ROWS} of {len(frame.dropna(subset=[x, y]))} paired rows."
            )
        return (
            [
                {x: _scalar(row[0]), y: _scalar(row[1])}
                for row in paired.itertuples(index=False, name=None)
            ],
            [x, y],
            warnings,
        )
    raise DatasetFileError("INVALID_CHART", "Choose a supported chart type.")


def _scalar(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    return value


def _finite_or_none(value):
    value = float(value)
    return value if math.isfinite(value) else None
