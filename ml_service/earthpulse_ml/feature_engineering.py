from __future__ import annotations
import pandas as pd
import numpy as np

AGG_WINDOWS = [6, 12, 24, 72, 168]  # hours: 6h, 12h, 1d, 3d, 7d

def add_lagged_aggregates(df: pd.DataFrame) -> pd.DataFrame:
    """
    Given a timeseries dataframe indexed by time,
    compute rolling aggregates useful for flood & wildfire risk.
    """
    work = df.sort_index().copy()

    # Ensure index has hourly frequency if possible
    if not pd.infer_freq(work.index):
        try:
            work = work.asfreq("H").interpolate()
        except Exception:
            pass

    # Ensure numeric types for safe rolling
    for col in work.columns:
        if not pd.api.types.is_numeric_dtype(work[col]):
            work[col] = pd.to_numeric(work[col], errors="coerce")

    # Rolling sums and means
    for win in AGG_WINDOWS:
        win_str = f"{win}h"
        if "precipitation" in work.columns:
            work[f"precip_sum_{win_str}"] = work["precipitation"].rolling(win, min_periods=1).sum()
        if "rain" in work.columns:
            work[f"rain_sum_{win_str}"] = work["rain"].rolling(win, min_periods=1).sum()
        if "wind_speed_10m" in work.columns:
            work[f"wind_mean_{win_str}"] = work["wind_speed_10m"].rolling(win, min_periods=1).mean()
        if "relative_humidity_2m" in work.columns:
            work[f"rh_mean_{win_str}"] = work["relative_humidity_2m"].rolling(win, min_periods=1).mean()
        if "temperature_2m" in work.columns:
            work[f"temp_mean_{win_str}"] = work["temperature_2m"].rolling(win, min_periods=1).mean()
        if "et0_fao_evapotranspiration" in work.columns:
            work[f"et0_sum_{win_str}"] = work["et0_fao_evapotranspiration"].rolling(win, min_periods=1).sum()
        if "fwi" in work.columns:
            work[f"fwi_mean_{win_str}"] = work["fwi"].rolling(win, min_periods=1).mean()

    # Dryness proxy (requires both rain and et0 aggregates)
    if {"rain_sum_168h", "et0_sum_168h"}.issubset(work.columns):
        work["water_balance_7d"] = work["rain_sum_168h"] - work["et0_sum_168h"]

    return work

IMPORTANT_FEATURES = [
    "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation", "rain",
    "snowfall", "surface_pressure", "cloud_cover", "et0_fao_evapotranspiration",
    "wind_gusts_10m", "dew_point_2m", "apparent_temperature"
]



def select_features(df: pd.DataFrame) -> pd.DataFrame:
    cols = [c for c in IMPORTANT_FEATURES if c in df.columns]
    return df[cols].copy()
