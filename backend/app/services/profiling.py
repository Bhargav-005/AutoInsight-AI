"""Bounded, deterministic readers for uploaded CSV and XLSX datasets."""

import csv
import hashlib
import json
import math
import random
import re
import zipfile
from datetime import date, datetime
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook


class DatasetFileError(ValueError):
    def __init__(self, code: str, message: str, details: dict | None = None):
        self.code = code
        self.details = details
        super().__init__(message)


def _headers_from_csv(path: Path, max_columns: int) -> tuple[list[str], str]:
    try:
        with path.open("r", encoding="utf-8-sig", errors="strict", newline="") as stream:
            sample = stream.read(64 * 1024)
            if not sample:
                raise DatasetFileError("INVALID_FILE", "The CSV file is empty.")
            try:
                delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
            except csv.Error:
                delimiter = ","
            stream.seek(0)
            headers = next(csv.reader(stream, delimiter=delimiter), None)
    except UnicodeDecodeError:
        raise DatasetFileError("INVALID_FILE", "CSV files must use UTF-8 encoding.") from None
    except csv.Error:
        raise DatasetFileError("INVALID_FILE", "The CSV header is malformed.") from None
    if not headers or not any(str(value).strip() for value in headers):
        raise DatasetFileError("INVALID_FILE", "The CSV file must contain a header row.")
    if len(headers) > max_columns:
        raise DatasetFileError("DATASET_LIMIT_EXCEEDED", "The dataset exceeds the column limit.")
    return [_display_header(value, index) for index, value in enumerate(headers)], delimiter


def _display_header(value, index: int) -> str:
    label = "" if value is None else str(value).strip()
    return label[:250] if label else f"Column {index + 1}"


def _xlsx_sheets(path: Path, max_columns: int) -> list[tuple[str, list[str]]]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
                raise DatasetFileError("INVALID_FILE", "The XLSX workbook structure is invalid.")
            if (
                len(names) > 20_000
                or sum(item.file_size for item in archive.infolist()) > 200_000_000
            ):
                raise DatasetFileError(
                    "DATASET_LIMIT_EXCEEDED", "The expanded workbook exceeds the processing limit."
                )
            if any(
                item.file_size > 1_000_000 and item.file_size / max(item.compress_size, 1) > 200
                for item in archive.infolist()
            ):
                raise DatasetFileError("INVALID_FILE", "The workbook uses unsupported compression.")
    except (OSError, zipfile.BadZipFile):
        raise DatasetFileError("INVALID_FILE", "The XLSX file is not a valid workbook.") from None
    try:
        with path.open("rb") as stream:
            workbook = load_workbook(stream, read_only=True, data_only=False, keep_links=False)
            try:
                if len(workbook.sheetnames) > 100:
                    raise DatasetFileError(
                        "DATASET_LIMIT_EXCEEDED", "The workbook exceeds the worksheet limit."
                    )
                sheets = []
                for sheet in workbook.worksheets:
                    if sheet.sheet_state != "visible":
                        continue
                    rows = sheet.iter_rows(min_row=1, max_row=1, values_only=False)
                    first = next(rows, ())
                    values = [cell.value for cell in first]
                    if not any(value is not None and str(value).strip() for value in values):
                        continue
                    if any(cell.data_type == "f" for cell in first):
                        raise DatasetFileError(
                            "FORMULAS_UNSUPPORTED",
                            "Formula cells are not evaluated; remove formulas before upload.",
                        )
                    if len(values) > max_columns:
                        raise DatasetFileError(
                            "DATASET_LIMIT_EXCEEDED", "The dataset exceeds the column limit."
                        )
                    sheets.append(
                        (
                            sheet.title,
                            [_display_header(value, index) for index, value in enumerate(values)],
                        )
                    )
            finally:
                workbook.close()
    except DatasetFileError:
        raise
    except Exception:
        raise DatasetFileError(
            "INVALID_FILE", "The XLSX workbook could not be opened safely."
        ) from None
    if not sheets:
        raise DatasetFileError(
            "INVALID_FILE", "The workbook has no visible sheet with a header row."
        )
    return sheets


def inspect_upload(path: Path, source_format: str, sheet_name: str | None, max_columns: int):
    if source_format == "csv":
        headers, delimiter = _headers_from_csv(path, max_columns)
        try:
            pd.read_csv(
                path,
                encoding="utf-8-sig",
                sep=delimiter,
                nrows=10,
                dtype=object,
                on_bad_lines="error",
                skip_blank_lines=False,
            )
        except (UnicodeDecodeError, pd.errors.ParserError, ValueError):
            raise DatasetFileError(
                "INVALID_FILE", "The CSV content is malformed or unreadable."
            ) from None
        return {"headers": headers, "sheet_name": None, "delimiter": delimiter}

    sheets = _xlsx_sheets(path, max_columns)
    names = [name for name, _ in sheets]
    if sheet_name is None:
        if len(sheets) != 1:
            raise DatasetFileError(
                "SHEET_SELECTION_REQUIRED",
                "Choose one worksheet to upload. Sheets are never combined.",
                {"sheets": names},
            )
        selected = sheets[0]
    else:
        selected = next((item for item in sheets if item[0] == sheet_name), None)
        if selected is None:
            raise DatasetFileError(
                "INVALID_SHEET", "Choose a visible worksheet in this workbook.", {"sheets": names}
            )
    return {"headers": selected[1], "sheet_name": selected[0], "delimiter": None}


class _DistinctCounter:
    """Exact for common columns, bounded HyperLogLog estimate for high cardinality."""

    precision = 10

    def __init__(self):
        self.values: set[str] | None = set()
        self.registers: bytearray | None = None

    def add(self, value: str):
        digest = int.from_bytes(
            hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest(), "big"
        )
        index = digest >> (64 - self.precision)
        remainder = (digest << self.precision) & ((1 << 64) - 1)
        rank = min(64 - self.precision + 1, (64 - remainder.bit_length()) + 1)
        if self.values is not None:
            self.values.add(value)
            if len(self.values) <= 2048:
                return
            self.registers = bytearray(1 << self.precision)
            for existing in self.values:
                self._add_hash(existing)
            self.values = None
        self.registers[index] = max(self.registers[index], rank)

    def _add_hash(self, value: str):
        digest = int.from_bytes(
            hashlib.blake2b(value.encode("utf-8"), digest_size=8).digest(), "big"
        )
        index = digest >> (64 - self.precision)
        remainder = (digest << self.precision) & ((1 << 64) - 1)
        rank = min(64 - self.precision + 1, (64 - remainder.bit_length()) + 1)
        self.registers[index] = max(self.registers[index], rank)

    def result(self):
        if self.values is not None:
            return len(self.values), True
        size = len(self.registers)
        estimate = (
            0.7213 / (1 + 1.079 / size) * size * size / sum(2.0**-value for value in self.registers)
        )
        zeroes = self.registers.count(0)
        if estimate <= 2.5 * size and zeroes:
            estimate = size * math.log(size / zeroes)
        return round(estimate), False


class _ColumnStats:
    def __init__(self, index: int, name: str):
        self.index = index
        self.name = name
        self.rows = 0
        self.missing = 0
        self.distinct = _DistinctCounter()
        self.samples = []
        self.numeric = True
        self.integer = True
        self.boolean = True
        self.datetime = True
        self.numeric_count = 0
        self.total = 0.0
        self.minimum = None
        self.maximum = None
        self.numeric_sample = []
        self.random = random.Random(index)
        self.non_finite = 0

    def add(self, value):
        self.rows += 1
        if _missing(value):
            self.missing += 1
            return None
        if isinstance(value, (datetime, date)):
            canonical = value.isoformat()
            number = None
            boolean_value = None
            is_date = True
        else:
            canonical = str(value).strip()
            if not canonical:
                self.missing += 1
                return None
            low = canonical.casefold()
            boolean_value = low if low in {"true", "false"} else None
            is_date = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[tT ].*)?", canonical))
            try:
                number = float(canonical.replace(",", ""))
            except ValueError:
                number = None
        self.distinct.add(canonical)
        if len(self.samples) < 5 and canonical not in self.samples:
            self.samples.append(_sample_value(value))
        self.boolean = self.boolean and boolean_value is not None
        if not is_date:
            self.datetime = False
        if number is None:
            self.numeric = False
            self.integer = False
            return None
        if not math.isfinite(number):
            self.non_finite += 1
            self.integer = False
            return number
        if not number.is_integer():
            self.integer = False
        self.numeric_count += 1
        self.total += number
        self.minimum = number if self.minimum is None else min(self.minimum, number)
        self.maximum = number if self.maximum is None else max(self.maximum, number)
        if len(self.numeric_sample) < 8192:
            self.numeric_sample.append(number)
        else:
            choice = self.random.randrange(self.numeric_count)
            if choice < len(self.numeric_sample):
                self.numeric_sample[choice] = number
        return canonical

    def result(self):
        count, exact = self.distinct.result()
        if self.rows == self.missing:
            data_type = "empty"
        elif self.boolean:
            data_type = "boolean"
        elif self.numeric:
            data_type = "integer" if self.integer and not self.non_finite else "number"
        elif self.datetime:
            data_type = "datetime"
        else:
            data_type = "string"
        numeric = None
        if data_type in {"integer", "number"} and self.numeric_count:
            numeric = {
                "min": self.minimum,
                "max": self.maximum,
                "mean": self.total / self.numeric_count,
                "median": float(pd.Series(self.numeric_sample, dtype="float64").median()),
                "median_is_approximate": self.numeric_count > len(self.numeric_sample),
                "non_finite_count": self.non_finite,
            }
        return {
            "id": f"column_{self.index + 1:03d}",
            "name": self.name,
            "data_type": data_type,
            "missing_count": self.missing,
            "missing_percent": round(100 * self.missing / self.rows, 2) if self.rows else 0.0,
            "distinct_count": count,
            "distinct_count_is_exact": exact,
            "sample_values": self.samples,
            "numeric_summary": numeric,
        }


def _missing(value) -> bool:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return True
    if isinstance(value, str):
        return value.strip().casefold() in {"", "na", "n/a", "nan", "null", "none"}
    return False


def _sample_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bool | int | float):
        number = float(value) if isinstance(value, float) else value
        if isinstance(number, float) and not math.isfinite(number):
            return str(value)
        return number
    return str(value)[:100]


class Profiler:
    def __init__(self, headers: list[str], max_rows: int):
        self.headers = headers
        self.max_rows = max_rows
        self.columns = [_ColumnStats(index, header) for index, header in enumerate(headers)]
        self.rows = 0
        self.duplicates = 0
        self.row_hashes: set[bytes] = set()

    def add(self, row):
        if self.rows >= self.max_rows:
            raise DatasetFileError("DATASET_LIMIT_EXCEEDED", "The dataset exceeds the row limit.")
        values = list(row)
        if len(values) > len(self.columns):
            raise DatasetFileError("INVALID_FILE", "A row contains more cells than the header.")
        values.extend([None] * (len(self.columns) - len(values)))
        canonical = [column.add(value) for column, value in zip(self.columns, values, strict=True)]
        digest = hashlib.sha256(
            json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode()
        ).digest()
        if digest in self.row_hashes:
            self.duplicates += 1
        else:
            self.row_hashes.add(digest)
        self.rows += 1

    def result(self):
        columns = [column.result() for column in self.columns]
        cells = self.rows * len(columns)
        missing = sum(column["missing_count"] for column in columns)
        return {
            "row_count": self.rows,
            "column_count": len(columns),
            "columns": columns,
            "duplicate_row_count": self.duplicates,
            "quality_summary": {
                "missing_cell_count": missing,
                "missing_cell_percent": round(100 * missing / cells, 2) if cells else 0.0,
                "columns_with_missing_values": sum(
                    column["missing_count"] > 0 for column in columns
                ),
                "duplicate_row_count": self.duplicates,
            },
            "methodology": {
                "missing_values": (
                    "Blank cells and case-insensitive NA, N/A, NaN, null, and none are missing."
                ),
                "duplicate_rows": "Exact duplicate rows after applying the missing-value rule.",
                "types": (
                    "Deterministic whole-column inference for integer, number, boolean, ISO date, "
                    "string, or empty."
                ),
                "distinct_counts": (
                    "Exact through 2048 values per column; HyperLogLog "
                    "estimate above that threshold."
                ),
                "median": (
                    "Exact through 8192 numeric values per column; deterministic reservoir "
                    "estimate above that threshold."
                ),
                "source_values": (
                    "The uploaded file is never rewritten; these are read-only summaries."
                ),
            },
        }


def profile_file(
    path: Path,
    source_format: str,
    sheet_name: str | None,
    max_rows: int,
    max_columns: int,
) -> dict:
    info = inspect_upload(path, source_format, sheet_name, max_columns)
    profiler = Profiler(info["headers"], max_rows)
    internal_names = [f"column_{index + 1:03d}" for index in range(len(info["headers"]))]
    if source_format == "csv":
        try:
            chunks = pd.read_csv(
                path,
                encoding="utf-8-sig",
                sep=info["delimiter"],
                names=internal_names,
                header=0,
                dtype=object,
                chunksize=2000,
                on_bad_lines="error",
                skip_blank_lines=False,
                keep_default_na=False,
                na_values=["", "NA", "N/A", "NaN", "null", "none"],
            )
            for chunk in chunks:
                for row in chunk.itertuples(index=False, name=None):
                    profiler.add(row)
        except DatasetFileError:
            raise
        except UnicodeDecodeError:
            raise DatasetFileError("INVALID_FILE", "CSV files must use UTF-8 encoding.") from None
        except (pd.errors.ParserError, ValueError):
            raise DatasetFileError(
                "INVALID_FILE", "The CSV content is malformed or unreadable."
            ) from None
    else:
        try:
            with path.open("rb") as stream:
                workbook = load_workbook(stream, read_only=True, data_only=False, keep_links=False)
                try:
                    sheet = workbook[sheet_name]
                    iterator = sheet.iter_rows(values_only=False)
                    next(iterator, None)
                    for row in iterator:
                        values = []
                        for cell in row[: len(info["headers"])]:
                            if cell.data_type == "f":
                                raise DatasetFileError(
                                    "FORMULAS_UNSUPPORTED",
                                    "Formula cells are not evaluated; remove formulas "
                                    "before upload.",
                                )
                            values.append(cell.value)
                        profiler.add(values)
                finally:
                    workbook.close()
        except DatasetFileError:
            raise
        except Exception:
            raise DatasetFileError(
                "INVALID_FILE", "The XLSX workbook could not be read safely."
            ) from None
    result = profiler.result()
    result["selected_sheet"] = info["sheet_name"]
    return result
