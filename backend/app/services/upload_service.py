"""
Excel file parsing service.
Extracts well names and cleans data according to the 'Production Data.xlsx' structure.
"""
import io
import re
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from app.core.column_config import (
    COLUMN_MAPPING,
    NULLABLE_COLUMNS,
    REQUIRED_COLUMNS,
)


def normalize_well_name(raw: str) -> str:
    """
    Normalize well name.
    Example: 'LF12-3 A1H' -> 'LF12-3-A1H'
    - Remove whitespace/tabs
    - Normalize consecutive hyphens
    - Insert hyphen at digit-letter boundary (e.g. '3A' -> '3-A')
    """
    name = str(raw).strip()
    # Replace whitespace with hyphens
    name = re.sub(r'\s+', '-', name)
    # Normalize consecutive hyphens
    name = re.sub(r'-+', '-', name)
    # Insert hyphen at digit-letter boundary only when digit is NOT preceded by a letter
    # e.g. '3A' -> '3-A' but 'A1H' stays 'A1H' (1 preceded by 'A')
    name = re.sub(r'(?<![A-Za-z])(\d)([A-Za-z])', r'\1-\2', name)
    return name


def parse_excel(file_bytes: bytes) -> tuple[str, pd.DataFrame, list[str]]:
    """
    Parse Excel byte data and return the well name and a cleaned DataFrame.

    Returns:
        well_name: Normalized well name
        df: Cleaned DataFrame (using DB column names)
        warnings: List of warning messages generated during processing
    """
    warnings: list[str] = []

    # Parse Excel file where the first row is the header
    raw_df = pd.read_excel(io.BytesIO(file_bytes), header=0)

    # Extract well name: first non-null value in column A (index 0)
    well_name_raw = raw_df.iloc[:, 0].dropna().iloc[0]
    well_name = normalize_well_name(str(well_name_raw))

    # Parse date column: column B (index 1)
    raw_df['date'] = pd.to_datetime(raw_df.iloc[:, 1], errors='coerce').dt.date

    # Remove rows where date parsing failed
    invalid_dates = raw_df['date'].isna().sum()
    if invalid_dates > 0:
        warnings.append(f"Skipped {invalid_dates} rows with invalid date")
    raw_df = raw_df.dropna(subset=['date'])

    # Rename columns from original Excel names to DB column names
    raw_df = raw_df.rename(columns=COLUMN_MAPPING)

    # Verify required columns are present
    missing = [c for c in REQUIRED_COLUMNS if c not in raw_df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    # Null handling: production columns should remain None, not 0
    for col in NULLABLE_COLUMNS:
        if col in raw_df.columns:
            raw_df[col] = raw_df[col].where(raw_df[col].notna(), other=None)

    # Convert NaN in numeric columns to None (for JSON/DB compatibility)
    numeric_cols = raw_df.select_dtypes(include=[np.number]).columns
    raw_df[numeric_cols] = raw_df[numeric_cols].where(raw_df[numeric_cols].notna(), other=None)

    # Remove duplicate dates (keep last value)
    duplicates = raw_df.duplicated(subset='date').sum()
    if duplicates > 0:
        warnings.append(f"Removed {duplicates} duplicate date rows (kept latest)")
    raw_df = raw_df.drop_duplicates(subset='date', keep='last')

    # Sort in ascending date order
    raw_df = raw_df.sort_values('date').reset_index(drop=True)

    # Drop Unnamed columns and the original first two columns
    cols_to_drop = [c for c in raw_df.columns if str(c).startswith('Unnamed')]
    # Original column A (well name column) remains if not in COLUMN_MAPPING → drop it
    if 'Well number (No.)' in raw_df.columns:
        cols_to_drop.append('Well number (No.)')
    raw_df = raw_df.drop(columns=cols_to_drop, errors='ignore')

    return well_name, raw_df, warnings


def dataframe_to_records(
    df: pd.DataFrame,
    well_id: str,
) -> list[dict]:
    """
    Convert a DataFrame to a list of dictionaries for DB upsert.
    None values are preserved as-is (stored as NULL in the DB).
    """
    records = []
    for _, row in df.iterrows():
        record: dict = {"well_id": well_id}
        for col in df.columns:
            val = row[col]
            # pandas NaN -> None (DB NULL)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                record[col] = None
            elif isinstance(val, (np.integer,)):
                record[col] = int(val)
            elif isinstance(val, (np.floating,)):
                record[col] = float(val)
            elif isinstance(val, date):
                record[col] = val
            else:
                record[col] = val
        records.append(record)
    return records
