from __future__ import annotations
import pandas as pd
import os


def create_flood_label(df):
    """
    Flood label based on rolling rainfall accumulation,
    aligned with hydrological reality.
    """
    # 24-hour accumulated rainfall
    rain_24h = df["precipitation"].rolling(24, min_periods=6).sum()

    # Thresholds based on IMD / hydrology practice
    return (
        (rain_24h >= 50) |        # severe rainfall
        (rain_24h >= 30) & (df["precipitation"] > 5)  # sustained rain
    ).astype(int)



def create_wildfire_label(df):
    """
    Wildfire label based on sustained dry-hot-windy conditions.
    """

    # Rolling dryness indicators
    temp_3d = df["temperature_2m"].rolling(72, min_periods=24).mean()
    humidity_3d = df["relative_humidity_2m"].rolling(72, min_periods=24).mean()
    wind_3d = df["wind_speed_10m"].rolling(72, min_periods=24).max()
    et0_3d = df["et0_fao_evapotranspiration"].rolling(72, min_periods=24).mean()

    return (
        (temp_3d >= 32) &
        (humidity_3d <= 35) &
        (
            (wind_3d >= 18) |
            (et0_3d >= 4.5)
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
