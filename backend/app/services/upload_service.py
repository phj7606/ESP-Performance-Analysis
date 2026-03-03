"""
Excel 파일 파싱 서비스.
'Production Data.xlsx' 구조에 맞춰 Well 이름 추출 + 데이터 정제.
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
    Well 이름 정규화.
    예: 'LF12-3 A1H' → 'LF12-3-A1H'
    - 공백/탭 제거
    - 연속 하이픈 정리
    - 숫자-영문 경계에 하이픈 삽입 (예: '3A' → '3-A')
    """
    name = str(raw).strip()
    # 공백을 하이픈으로 치환
    name = re.sub(r'\s+', '-', name)
    # 연속 하이픈 정리
    name = re.sub(r'-+', '-', name)
    # 숫자와 영문자 사이에 하이픈 삽입 (예: '3A' → '3-A')
    name = re.sub(r'(\d)([A-Za-z])', r'\1-\2', name)
    return name


def parse_excel(file_bytes: bytes) -> tuple[str, pd.DataFrame, list[str]]:
    """
    Excel 바이트 데이터를 파싱하여 Well 이름과 정제된 DataFrame 반환.

    Returns:
        well_name: 정규화된 Well 이름
        df: 정제된 데이터프레임 (DB 컬럼명 기준)
        warnings: 처리 중 발생한 경고 메시지 목록
    """
    warnings: list[str] = []

    # 첫 행이 헤더인 Excel 파일 파싱
    raw_df = pd.read_excel(io.BytesIO(file_bytes), header=0)

    # Well 이름 추출: A열(인덱스 0) 첫 번째 non-null 값
    well_name_raw = raw_df.iloc[:, 0].dropna().iloc[0]
    well_name = normalize_well_name(str(well_name_raw))

    # 날짜 컬럼 파싱: B열(인덱스 1)
    raw_df['date'] = pd.to_datetime(raw_df.iloc[:, 1], errors='coerce').dt.date

    # 날짜 파싱 실패 행 제거
    invalid_dates = raw_df['date'].isna().sum()
    if invalid_dates > 0:
        warnings.append(f"날짜 파싱 실패 행 {invalid_dates}개 제외됨")
    raw_df = raw_df.dropna(subset=['date'])

    # Excel 원본 컬럼명 → DB 컬럼명으로 변환
    raw_df = raw_df.rename(columns=COLUMN_MAPPING)

    # 필수 컬럼 존재 확인
    missing = [c for c in REQUIRED_COLUMNS if c not in raw_df.columns]
    if missing:
        raise ValueError(f"필수 컬럼 누락: {missing}")

    # Null 처리: 생산량 컬럼은 0이 아닌 None으로 유지
    for col in NULLABLE_COLUMNS:
        if col in raw_df.columns:
            raw_df[col] = raw_df[col].where(raw_df[col].notna(), other=None)

    # 숫자형 컬럼의 NaN을 None으로 변환 (JSON/DB 호환)
    numeric_cols = raw_df.select_dtypes(include=[np.number]).columns
    raw_df[numeric_cols] = raw_df[numeric_cols].where(raw_df[numeric_cols].notna(), other=None)

    # 중복 날짜 제거 (마지막 값 유지)
    duplicates = raw_df.duplicated(subset='date').sum()
    if duplicates > 0:
        warnings.append(f"중복 날짜 {duplicates}개 제거됨 (최신 값 유지)")
    raw_df = raw_df.drop_duplicates(subset='date', keep='last')

    # 날짜 오름차순 정렬
    raw_df = raw_df.sort_values('date').reset_index(drop=True)

    # Unnamed 컬럼 및 원본 첫 두 컬럼 제거
    cols_to_drop = [c for c in raw_df.columns if str(c).startswith('Unnamed')]
    # 원본 A열 (Well 이름 컬럼)이 COLUMN_MAPPING에 없으면 그대로 남음 → 제거
    if 'Well number (No.)' in raw_df.columns:
        cols_to_drop.append('Well number (No.)')
    raw_df = raw_df.drop(columns=cols_to_drop, errors='ignore')

    return well_name, raw_df, warnings


def dataframe_to_records(
    df: pd.DataFrame,
    well_id: str,
) -> list[dict]:
    """
    DataFrame을 DB 업서트용 딕셔너리 목록으로 변환.
    None 값은 그대로 유지 (DB의 NULL로 저장됨).
    """
    records = []
    for _, row in df.iterrows():
        record: dict = {"well_id": well_id}
        for col in df.columns:
            val = row[col]
            # pandas NaN → None (DB NULL)
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
