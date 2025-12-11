from __future__ import annotations
import pandas as pd
import os

def build_wildfire_dataset(df: pd.DataFrame, out_name: str) -> pd.DataFrame:
    if "wildfire_label" not in df.columns:
        raise ValueError("Missing 'wildfire_label' column for wildfire mode.")
    df = df.rename(columns={"wildfire_label": "label"})
    os.makedirs("data/processed", exist_ok=True)
    out_parquet = os.path.join("data/processed", os.path.basename(out_name))
    df.to_parquet(out_parquet, index=False)
    print(f"🔥 Wildfire dataset saved → {out_parquet}")
    return df

def build_flood_dataset(df: pd.DataFrame, out_name: str) -> pd.DataFrame:
    if "flood_label" not in df.columns:
        raise ValueError("Missing 'flood_label' column for flood mode.")
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
