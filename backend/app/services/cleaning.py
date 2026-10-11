"""Allowlisted deterministic transformations over bounded dataset versions."""

import csv
import math
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

from app.services.profiling import DatasetFileError, _headers_from_csv, _xlsx_sheets

MISSING = {"", "na", "n/a", "nan", "null", "none"}


def read_frame(
    path: Path,
    source_format: str,
    sheet_name: str | None,
    max_columns: int,
    max_rows: int = 100_000,
):
    if source_format == "csv":
        headers, delimiter = _headers_from_csv(path, max_columns)
        names = [f"column_{index + 1:03d}" for index in range(len(headers))]
        try:
            frame = pd.read_csv(
                path,
                sep=delimiter,
                encoding="utf-8-sig",
                dtype=object,
                names=names,
                header=0,
                nrows=max_rows + 1,
                keep_default_na=False,
                na_values=list(MISSING),
                skip_blank_lines=False,
                on_bad_lines="error",
            )
        except (UnicodeDecodeError, pd.errors.ParserError, ValueError):
            raise DatasetFileError(
                "INVALID_FILE", "The dataset file could not be read safely."
            ) from None
        if len(frame) > max_rows:
            raise DatasetFileError(
                "DATASET_LIMIT_EXCEEDED", "The dataset exceeds the row processing limit."
            )
        return frame, headers
    sheets = _xlsx_sheets(path, max_columns)
    selected = sheet_name or (sheets[0][0] if len(sheets) == 1 else None)
    if selected is None or selected not in {name for name, _ in sheets}:
        raise DatasetFileError("INVALID_SHEET", "The selected worksheet is unavailable.")
    headers = next(items for name, items in sheets if name == selected)
    rows = []
    try:
        with path.open("rb") as stream:
            workbook = load_workbook(stream, read_only=True, data_only=False, keep_links=False)
            try:
                iterator = workbook[selected].iter_rows(values_only=False)
                next(iterator, None)
                for row in iterator:
                    values = []
                    for cell in row[: len(headers)]:
                        if cell.data_type == "f":
                            raise DatasetFileError(
                                "FORMULAS_UNSUPPORTED", "Spreadsheet formulas are not supported."
                            )
                        values.append(cell.value)
                    values.extend([None] * (len(headers) - len(values)))
                    rows.append(values)
                    if len(rows) > max_rows:
                        raise DatasetFileError(
                            "DATASET_LIMIT_EXCEEDED",
                            "The dataset exceeds the row processing limit.",
                        )
            finally:
                workbook.close()
    except DatasetFileError:
        raise
    except Exception:
        raise DatasetFileError(
            "INVALID_FILE", "The selected worksheet could not be read safely."
        ) from None
    frame = pd.DataFrame(rows, columns=[f"column_{i + 1:03d}" for i in range(len(headers))])
    for column in frame.columns:
        frame[column] = frame[column].map(_missing_value)
    return frame, headers


def _missing_value(value):
    if value is None or (isinstance(value, str) and value.strip().casefold() in MISSING):
        return pd.NA
    return value


def apply_operations(frame: pd.DataFrame, operations: list[dict]):
    output = frame.copy(deep=True)
    effects = []
    for operation in operations:
        kind = operation["op"]
        before_rows = len(output)
        changed = 0
        column = operation.get("column")
        if column is not None and column not in output.columns:
            raise DatasetFileError("INVALID_COLUMN", "A selected column is unavailable.")
        if kind == "drop_duplicates":
            subset = operation.get("columns") or list(output.columns)
            if any(value not in output.columns for value in subset):
                raise DatasetFileError("INVALID_COLUMN", "A selected column is unavailable.")
            output = output.drop_duplicates(subset=subset, keep=operation.get("keep", "first"))
            changed = before_rows - len(output)
        elif kind == "drop_missing_rows":
            subset = operation.get("columns") or list(output.columns)
            if any(value not in output.columns for value in subset):
                raise DatasetFileError("INVALID_COLUMN", "A selected column is unavailable.")
            output = output.dropna(subset=subset, how="any")
            changed = before_rows - len(output)
        elif kind == "fill_missing":
            series = output[column]
            missing = int(series.isna().sum())
            strategy = operation["strategy"]
            if strategy == "constant":
                value = operation.get("value")
            elif strategy == "mode":
                modes = series.dropna().mode()
                if modes.empty:
                    raise DatasetFileError(
                        "EMPTY_COLUMN", "The selected column has no values to fill."
                    )
                value = modes.iloc[0]
            else:
                numeric = pd.to_numeric(series, errors="coerce")
                invalid_values = series.notna() & numeric.isna()
                if invalid_values.any():
                    raise DatasetFileError(
                        "INVALID_TYPE", "Numeric fill requires a column of numeric values."
                    )
                valid = numeric.dropna()
                if valid.empty:
                    raise DatasetFileError("INVALID_TYPE", "Numeric fill requires numeric values.")
                ordered = sorted(float(item) for item in valid)
                if strategy == "mean":
                    value = math.fsum(item / len(ordered) for item in ordered)
                else:
                    middle = len(ordered) // 2
                    value = (
                        ordered[middle]
                        if len(ordered) % 2
                        else ordered[middle - 1] / 2 + ordered[middle] / 2
                    )
            output[column] = series.fillna(value)
            changed = missing
        elif kind == "trim_whitespace":
            before_values = output[column].copy()
            output[column] = output[column].map(
                lambda value: value.strip() if isinstance(value, str) else value
            )
            output[column] = output[column].map(_missing_value)
            changed = int((output[column] != before_values).fillna(False).sum())
        elif kind == "replace_text":
            if not isinstance(operation["find"], str) or not isinstance(operation["replace"], str):
                raise DatasetFileError("INVALID_OPERATION", "Text replacement values must be text.")
            before_values = output[column].copy()
            find = operation["find"]
            replacement = operation["replace"]
            output[column] = output[column].map(
                lambda value, find=find, replacement=replacement: (
                    value.replace(find, replacement) if isinstance(value, str) else value
                )
            )
            changed = int((output[column] != before_values).fillna(False).sum())
        elif kind == "cast_numeric":
            converted = pd.to_numeric(output[column], errors="coerce")
            non_finite = converted.map(
                lambda value: pd.notna(value) and not math.isfinite(float(value))
            )
            invalid = output[column].notna() & (converted.isna() | non_finite)
            if invalid.any() and operation["invalid"] == "error":
                raise DatasetFileError("INVALID_TYPE", "Values could not be converted to numbers.")
            changed = int(invalid.sum())
            output[column] = converted.mask(non_finite, pd.NA)
        else:
            raise DatasetFileError("INVALID_OPERATION", "The cleaning operation is unsupported.")
        effects.append({"op": kind, "column": column, "rows_changed": changed})
    return output.reset_index(drop=True), {
        "source_rows": len(frame),
        "result_rows": len(output),
        "rows_removed": len(frame) - len(output),
        "operations": effects,
    }


def preview(frame: pd.DataFrame, cleaned: pd.DataFrame, summary: dict, headers: list[str]):
    def sample(frame):
        return [
            {f"column_{index + 1:03d}": _json_cell(value) for index, value in enumerate(row)}
            for row in frame.head(10).itertuples(index=False, name=None)
        ]

    return {
        **summary,
        "source_missing_cells": int(frame.isna().sum().sum()),
        "result_missing_cells": int(cleaned.isna().sum().sum()),
        "source_duplicate_rows": int(frame.duplicated().sum()),
        "result_duplicate_rows": int(cleaned.duplicated().sum()),
        "before": sample(frame),
        "after": sample(cleaned),
        "warnings": ["Preview is read-only; no artifact or dataset version was created."],
    }


def _json_cell(value):
    if value is None or value is pd.NA or pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not pd.notna(value):
        return None
    return value


def write_cleaned_csv(path: Path, frame: pd.DataFrame, headers: list[str]):
    # Data is encoded as plain CSV values; never interpret user strings as formulas.
    exported = frame.copy(deep=True)
    exported.columns = headers
    exported.to_csv(path, index=False, encoding="utf-8", na_rep="", quoting=csv.QUOTE_MINIMAL)
