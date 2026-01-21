import pandas as pd
import numpy as np
from tensorflow.keras.models import load_model
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix
)

MODEL_PATH = r"D:\projects\sem7\earthpulse\backend\models\flood_model.keras"
DATA_PATH  = r"D:\projects\sem7\earthpulse\backend\processed\flood.parquet"
FEATURES_PATH = r"D:\projects\sem7\earthpulse\backend\models\flood_model.keras.features.txt"
TARGET_COL = "label"

# Load dataset
df = pd.read_parquet(DATA_PATH)

# Load feature list
with open(FEATURES_PATH) as f:
    FEATURES = [line.strip() for line in f.readlines()]

print("Using features:", FEATURES)

X = df[FEATURES]
y = df[TARGET_COL]

# Larger test set for realism
from sklearn.model_selection import StratifiedShuffleSplit

sss = StratifiedShuffleSplit(n_splits=1, test_size=0.3, random_state=42)

for _, test_idx in sss.split(X, y):
    X_test = X.iloc[test_idx]
    y_test = y.iloc[test_idx]


# Load model
model = load_model(MODEL_PATH)

# Recompile for evaluation
model.compile(
    optimizer="adam",
    loss="binary_crossentropy",
    metrics=["accuracy"]
)

# --- Accuracy & loss ---
loss, acc = model.evaluate(X_test, y_test, verbose=0)

# --- Predictions ---
y_prob = model.predict(X_test).ravel()
y_pred = (y_prob >= 0.9).astype(int)

# --- Additional metrics ---
precision = precision_score(y_test, y_pred)
recall = recall_score(y_test, y_pred)
f1 = f1_score(y_test, y_pred)
auc = roc_auc_score(y_test, y_prob)
cm = confusion_matrix(y_test, y_pred)

# --- Print results ---
print("\n📊 Model Evaluation Results")
print(f"Loss      : {loss:.4f}")
print(f"Accuracy  : {acc:.4f}")
print(f"Precision : {precision:.4f}")
print(f"Recall    : {recall:.4f}")
print(f"F1-score  : {f1:.4f}")
print(f"ROC-AUC   : {auc:.4f}")

print("\nConfusion Matrix:")
print(cm)
