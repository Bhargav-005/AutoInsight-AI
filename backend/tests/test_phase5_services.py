import pandas as pd
import pytest

from app.services.analytics import chart_data, correlation, grouped, summarize
from app.services.cleaning import apply_operations, preview
from app.services.profiling import DatasetFileError


def test_cleaning_handles_missing_duplicates_numeric_and_text_without_mutating_source():
    source = pd.DataFrame(
        {
            "column_001": ["1", "2", "2", None],
            "column_002": [" alpha ", "beta", "beta", None],
        }
    )
    original = source.copy(deep=True)
    operations = [
        {"op": "trim_whitespace", "column": "column_002"},
        {"op": "replace_text", "column": "column_002", "find": "alpha", "replace": "A"},
        {"op": "fill_missing", "column": "column_001", "strategy": "mean"},
        {"op": "drop_duplicates"},
    ]
    cleaned, details = apply_operations(source, operations)
    assert source.equals(original)
    assert cleaned["column_001"].tolist()[:2] == ["1", "2"]
    assert cleaned["column_001"].iloc[2] == pytest.approx(5 / 3)
    assert cleaned["column_002"].iloc[:2].tolist() == ["A", "beta"]
    assert pd.isna(cleaned["column_002"].iloc[2])
    assert details["rows_removed"] == 1
    result = preview(source, cleaned, details, ["value", "label"])
    assert result["source_missing_cells"] == 2
    assert "read-only" in result["warnings"][0]


def test_cleaning_rejects_invalid_numeric_conversion_without_source_changes():
    source = pd.DataFrame({"column_001": ["1", "bad"]})
    with pytest.raises(DatasetFileError):
        apply_operations(
            source, [{"op": "cast_numeric", "column": "column_001", "invalid": "error"}]
        )
    assert source["column_001"].tolist() == ["1", "bad"]
    converted, _ = apply_operations(
        source.iloc[:1], [{"op": "cast_numeric", "column": "column_001", "invalid": "error"}]
    )
    assert converted["column_001"].iloc[0] == 1


def test_grouped_aggregates_use_underlying_values_and_summary_is_exact():
    frame = pd.DataFrame(
        {
            "column_001": ["East", "East", "West", "West"],
            "column_002": [10, 30, 5, 15],
            "column_003": [1, 0, 1, 0],
        }
    )
    means, warnings = grouped(frame, ["column_001"], "mean", "column_002")
    totals, _ = grouped(frame, ["column_001"], "sum", "column_002")
    assert means == [{"column_001": "East", "value": 20.0}, {"column_001": "West", "value": 10.0}]
    assert totals == [{"column_001": "East", "value": 40}, {"column_001": "West", "value": 20}]
    assert warnings == []
    summary = summarize(frame, ["region", "sales", "flag"], "dataset", "version")
    assert summary["rows_analyzed"] == 4 and summary["exact"] is True
    sales = summary["columns"][1]["numeric"]
    assert sales["mean"] == 15 and sales["median"] == 12.5 and sales["stddev"] > 0


def test_correlation_chart_and_constant_column_warnings_are_grounded_in_rows():
    frame = pd.DataFrame(
        {"column_001": [1, 2, 3], "column_002": [2, 4, 6], "column_003": [7, 7, 7]}
    )
    result = correlation(frame)
    assert result["matrix"][0]["values"][1] == pytest.approx(1)
    assert result["matrix"][2]["values"][0] is None
    assert result["warnings"]
    points, columns, warnings = chart_data(frame, "scatter", "column_001", "column_002")
    assert points == [
        {"column_001": 1, "column_002": 2},
        {"column_001": 2, "column_002": 4},
        {"column_001": 3, "column_002": 6},
    ]
    assert columns == ["column_001", "column_002"] and warnings == []


def test_numeric_overflow_is_reported_instead_of_returned_as_an_infinite_result():
    frame = pd.DataFrame({"column_001": [1e308, 1e308], "column_002": ["A", "A"]})
    result = summarize(frame, ["value", "group"], "dataset", "version")
    assert result["exact"] is True
    assert result["columns"][0]["numeric"]["mean"] == 1e308
    with pytest.raises(DatasetFileError, match="numeric range"):
        grouped(frame, ["column_002"], "sum", "column_001")
