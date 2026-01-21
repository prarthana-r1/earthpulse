from __future__ import annotations
import pandas as pd
import os


def create_flood_label(df):
    """
    Flood label based on extreme precipitation
    using dataset-calibrated threshold.
    """
    # Flood if precipitation is in top ~5% of observed values
    threshold = df["precipitation"].quantile(0.95)
    return (df["precipitation"] >= threshold).astype(int)


def create_wildfire_label(df):
    """
    Wildfire label based on extreme hot, dry, and windy conditions
    using dataset-calibrated quantile thresholds.
    """

    # High temperature (top 10%)
    t_thresh = df["temperature_2m"].quantile(0.90)

    # Low humidity (bottom 10%)
    h_thresh = df["relative_humidity_2m"].quantile(0.10)

    # High wind (top 10%)
    w_thresh = df["wind_speed_10m"].quantile(0.90)

    # Optional dryness indicator (top 10%)
    e_thresh = df["et0_fao_evapotranspiration"].quantile(0.90)

    return (
        (df["temperature_2m"] >= t_thresh) &
        (df["relative_humidity_2m"] <= h_thresh) &
        (
            (df["wind_speed_10m"] >= w_thresh) |
            (df["et0_fao_evapotranspiration"] >= e_thresh)
        )
    ).astype(int)


def build_wildfire_dataset(df: pd.DataFrame, out_name: str) -> pd.DataFrame:
    # Create wildfire_label using climate extremes
    df["wildfire_label"] = create_wildfire_label(df)

    # Map wildfire_label → label
    df = df.rename(columns={"wildfire_label": "label"})

    os.makedirs("data/processed", exist_ok=True)
    out_parquet = os.path.join("data/processed", os.path.basename(out_name))
    df.to_parquet(out_parquet, index=False)
    print(f"🔥 Wildfire dataset saved → {out_parquet}")
    return df


def build_flood_dataset(df: pd.DataFrame, out_name: str) -> pd.DataFrame:
    # Create flood_label if it does not exist or is empty
    df["flood_label"] = create_flood_label(df)

# Map flood_label → label (expected by training)
    df = df.rename(columns={"flood_label": "label"})

    os.makedirs("data/processed", exist_ok=True)
    out_parquet = os.path.join("data/processed", os.path.basename(out_name))
    df.to_parquet(out_parquet, index=False)
    print(f"🌊 Flood dataset saved → {out_parquet}")
    return df

if __name__ == "__main__":
    import argparse, sys
    ap = argparse.ArgumentParser(description="Convert all_weather.csv to flood/wildfire datasets")
    ap.add_argument("--mode", choices=["flood", "wildfire", "both"], required=True)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    df = pd.read_csv(args.csv)

    if args.mode == "flood":
        build_flood_dataset(df, args.out)
    elif args.mode == "wildfire":
        build_wildfire_dataset(df, args.out)
    elif args.mode == "both":
        print("⚙️ Running BOTH mode...")
        build_flood_dataset(df, "flood.parquet")
        build_wildfire_dataset(df, "wildfire.parquet")
        print("✅ Both mode complete")
        sys.exit(0)
