from __future__ import annotations
import os
import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from earthpulse_ml.feature_engineering import select_features

def _load_xy(parquet_path: str):
    df = pd.read_parquet(parquet_path)

    # Validate label presence
    if "label" not in df.columns:
        raise ValueError(f"'label' column not found in {parquet_path}")

    X = select_features(df).fillna(0.0).values.astype("float32")
    y = df["label"].astype("int32").values
    return X, y, df

def _build_mlp(input_dim: int, X_train: np.ndarray) -> tf.keras.Model:
    norm = tf.keras.layers.Normalization()
    norm.adapt(X_train)

    inputs = tf.keras.Input(shape=(input_dim,))
    x = norm(inputs)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    x = tf.keras.layers.Dense(64, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    x = tf.keras.layers.Dense(32, activation="relu")(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid")(x)

    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="binary_crossentropy",
        metrics=[tf.keras.metrics.AUC(name="auc"), "accuracy"]
    )
    return model

def train_model(parquet_path: str, out_path: str):
    X, y, df = _load_xy(parquet_path)
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    class_weights = compute_class_weight(class_weight="balanced", classes=np.unique(y), y=y)
    cw = {i: w for i, w in enumerate(class_weights)}

    model = _build_mlp(X.shape[1], X_train)

    early = tf.keras.callbacks.EarlyStopping(
        monitor="val_auc", mode="max", patience=10, restore_best_weights=True
    )

    model.fit(
        X_train, y_train,
        epochs=100, batch_size=256,
        validation_data=(X_val, y_val),
        callbacks=[early], class_weight=cw, verbose=2
    )

    # Ensure output directory exists
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # Save model
    model.save(out_path)
    if not os.path.exists(out_path):
        raise IOError(f"Model failed to save at: {out_path}")
    print(f"✅ Model saved at: {out_path}")

    # Save feature names for inference
    feat_cols = select_features(df).columns.tolist()
    feat_file = out_path + ".features.txt"
    with open(feat_file, "w") as f:
        f.write("\n".join(feat_cols))
    print(f"📝 Feature list saved at: {feat_file}")

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Path to training parquet")
    ap.add_argument("--out", required=True, help="Output .keras model path")
    args = ap.parse_args()
    train_model(args.data, args.out)
