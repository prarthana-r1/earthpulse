import pandas as pd
df = pd.read_parquet("D:\\projects\\sem7\\earthpulse\\backend\\data\\processed\\widlfire.parquet")
print(df["label"].value_counts())
print(df["label"].value_counts(normalize=True))
