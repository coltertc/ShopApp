#!/usr/bin/env python3
"""
IS455 ML training — same logic as pipeline.ipynb / results/pipeline_sklearn.py.

Writes only Joblib artifacts:
  - model.joblib              (latest model, overwritten each run)
  - joblib/model_<timestamp>.joblib   (archive copy each run)

Requires shop.db in this directory (or set SHOP_DB_PATH).
Console: training logs only; no PNG/JSON/MD files.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import warnings
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from scipy.stats import yeojohnson
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("SHOP_DB_PATH", os.path.join(BASE_DIR, "shop.db"))
TARGET_COL = "is_fraud"
TASK_TYPE = "Classification"
RANDOM_STATE = 27
ARCHIVE_SUBDIR = "joblib"
MODEL_FILENAME = "model.joblib"


def basic_wrangling(
    df, features=[], missing_threshold=0.95, unique_threshold=0.95, messages=True
):
    if not features:
        features = df.columns
    for feat in features:
        if feat in df.columns:
            missing = df[feat].isna().sum()
            unique = df[feat].nunique()
            rows = df.shape[0]
            if missing / rows >= missing_threshold:
                if messages:
                    print(
                        f"Dropping {feat}: {missing} missing values out of {rows} ({round(missing/rows, 2)})"
                    )
                df.drop(columns=[feat], inplace=True)
            elif unique / rows >= unique_threshold:
                if df[feat].dtype in ["int64", "object"]:
                    if messages:
                        print(
                            f"Dropping {feat}: {unique} unique values out of {rows} ({round(unique/rows, 2)})"
                        )
                    df.drop(columns=[feat], inplace=True)
            elif unique == 1:
                if messages:
                    print(
                        f"Dropping {feat}: Contains only one unique value ({df[feat].unique()[0]})"
                    )
                df.drop(columns=[feat], inplace=True)
    return df


def parse_date(
    df, features=[], days_since_today=False, drop_date=True, messages=True
):
    from datetime import datetime as dt

    for feat in features:
        if feat in df.columns:
            df[feat] = pd.to_datetime(df[feat])
            df[f"{feat}_year"] = df[feat].dt.year
            df[f"{feat}_month"] = df[feat].dt.month
            df[f"{feat}_day"] = df[feat].dt.day
            df[f"{feat}_weekday"] = df[feat].dt.day_name()
            if days_since_today:
                df[f"{feat}_days_until_today"] = (dt.today() - df[feat]).dt.days
            if drop_date:
                df.drop(columns=[feat], inplace=True)
    return df


def skew_correct(df, feature, methods=None, messages=True, visualize=False):
    if methods is None:
        methods = ["none", "cbrt", "sqrt", "log1p", "yeojohnson"]
    if feature not in df.columns:
        return df
    x = pd.to_numeric(df[feature], errors="coerce")
    if x.notna().sum() == 0:
        return df

    def _shift_nonneg(s: pd.Series):
        min_val = s.min(skipna=True)
        if pd.isna(min_val):
            return s, 0.0
        shift = -float(min_val) if min_val < 0 else 0.0
        return s + shift, shift

    x_shifted, _shift_amt = _shift_nonneg(x)
    candidates = {"none": x.astype("float64")}
    candidates["cbrt"] = np.cbrt(x_shifted.clip(lower=0)).astype("float64")
    candidates["sqrt"] = np.sqrt(x_shifted.clip(lower=0)).astype("float64")
    candidates["log1p"] = np.log1p(x_shifted.clip(lower=0)).astype("float64")
    if "yeojohnson" in methods:
        try:
            x_nonmissing = x.dropna().to_numpy(dtype="float64")
            yj_vals, _ = yeojohnson(x_nonmissing)
            yj_series = x.astype("float64").copy()
            yj_series.loc[x.dropna().index] = yj_vals
            candidates["yeojohnson"] = yj_series
        except Exception:
            pass
    best_name, best_series, best_score = None, None, np.inf
    for name in methods:
        if name not in candidates:
            continue
        sk = candidates[name].skew(skipna=True)
        score = abs(sk) if not pd.isna(sk) else np.inf
        if score < best_score:
            best_score, best_name, best_series = score, name, candidates[name]
    df[f"{feature}_skewfix"] = best_series.astype("float64")
    return df


def missing_drop(
    df, label="", features=[], messages=True, row_threshold=0.9, col_threshold=0.5
):
    df.dropna(axis=1, thresh=round(col_threshold * df.shape[0]), inplace=True)
    df.dropna(axis=0, thresh=round(row_threshold * df.shape[1]), inplace=True)
    if label != "":
        df.dropna(axis=0, subset=[label], inplace=True)

    def generate_missing_table():
        df_results = pd.DataFrame(columns=["Missing", "column", "rows"])
        for feat in df:
            missing = df[feat].isna().sum()
            if missing > 0:
                memory_col = df.drop(columns=[feat]).count().sum()
                memory_rows = df.dropna(subset=[feat]).count().sum()
                df_results.loc[feat] = [missing, memory_col, memory_rows]
        return df_results

    df_results = generate_missing_table()
    while df_results.shape[0] > 0:
        best = df_results[["column", "rows"]].max(axis=1).iloc[0]
        max_axis = df_results.columns[df_results.isin([best]).any()][0]
        df_results.sort_values(by=[max_axis], ascending=False, inplace=True)
        if max_axis == "rows":
            df.dropna(axis=0, subset=[df_results.index[0]], inplace=True)
        else:
            df.drop(columns=[df_results.index[0]], inplace=True)
        df_results = generate_missing_table()
    return df


def clean_outlier(df, features=[], method="remove", messages=True, skew_threshold=1):
    for feat in features:
        if feat in df.columns and pd.api.types.is_numeric_dtype(df[feat]):
            skew = df[feat].skew()
            if abs(skew) > skew_threshold:
                q1, q3 = df[feat].quantile(0.25), df[feat].quantile(0.75)
                min_val, max_val = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            else:
                m, s = df[feat].mean(), df[feat].std()
                min_val, max_val = m - 3 * s, m + 3 * s
            if method == "remove":
                df = df[(df[feat] >= min_val) & (df[feat] <= max_val)]
            elif method == "replace":
                df.loc[df[feat] < min_val, feat] = min_val
                df.loc[df[feat] > max_val, feat] = max_val
    return df


def main():
    if not os.path.isfile(DB_PATH):
        raise FileNotFoundError(
            f"Database not found: {DB_PATH}\n"
            "Place shop.db next to this script or set SHOP_DB_PATH."
        )

    archive_dir = os.path.join(BASE_DIR, ARCHIVE_SUBDIR)
    os.makedirs(archive_dir, exist_ok=True)

    if TASK_TYPE != "Classification":
        print("TASK_TYPE is not Classification; notebook expects classification.")

    conn = sqlite3.connect(DB_PATH)
    query = """
    SELECT o.*, c.gender, c.city, c.state, c.customer_segment, c.loyalty_tier, c.birthdate,
           c.created_at as customer_created_at
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    """
    df = pd.read_sql_query(query, conn)
    conn.close()

    print(f"Shape: {df.shape}")
    print("Value Counts for Target:")
    print(df[TARGET_COL].value_counts(normalize=True))
    print("\nMissingness Summary:")
    print(df.isnull().sum())

    df = basic_wrangling(df, messages=True)

    date_cols = ["order_datetime", "birthdate", "customer_created_at"]
    df = parse_date(
        df, features=[c for c in date_cols if c in df.columns], messages=True
    )

    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if TARGET_COL in num_cols:
        num_cols.remove(TARGET_COL)
    for col in num_cols:
        df = skew_correct(df, col, methods=["none", "log1p"])

    df = missing_drop(df, label=TARGET_COL)
    df = clean_outlier(df, features=num_cols)

    print(f"Shape after cleaning: {df.shape}")

    X = df.drop(columns=[TARGET_COL])
    y = df[TARGET_COL]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE
    )

    numeric_features = X.select_dtypes(include=["int64", "float64"]).columns
    categorical_features = X.select_dtypes(include=["object"]).columns

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_features,
            ),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_features,
            ),
        ]
    )

    results = []
    models = [
        ("Baseline", DummyClassifier(strategy="stratified")),
        ("Linear", LogisticRegression(max_iter=1000)),
        ("Ensemble", XGBClassifier(random_state=RANDOM_STATE)),
    ]

    for name, model in models:
        pipe = Pipeline(
            steps=[("preprocessor", preprocessor), ("classifier", model)]
        )
        pipe.fit(X_train, y_train)
        y_pred = pipe.predict(X_test)
        y_prob = (
            pipe.predict_proba(X_test)[:, 1]
            if hasattr(model, "predict_proba")
            else y_pred
        )
        results.append(
            {
                "Model": name,
                "Accuracy": accuracy_score(y_test, y_pred),
                "F1": f1_score(y_test, y_pred, average="weighted"),
                "ROC AUC": roc_auc_score(y_test, y_prob),
            }
        )

    comparison_df = pd.DataFrame(results)
    print(comparison_df)

    best_model_name = comparison_df.sort_values(by="F1", ascending=False).iloc[0][
        "Model"
    ]
    print(f"\nBest Model: {best_model_name}")

    if best_model_name == "Ensemble":
        param_dist = {
            "classifier__n_estimators": [50, 100, 200],
            "classifier__max_depth": [3, 6, 10],
            "classifier__learning_rate": [0.01, 0.1, 0.2],
        }
        best_clf = XGBClassifier(random_state=RANDOM_STATE)
    else:
        param_dist = {"classifier__C": [0.1, 1, 10]}
        best_clf = LogisticRegression(max_iter=1000)

    tuned_pipe = Pipeline(
        steps=[("preprocessor", preprocessor), ("classifier", best_clf)]
    )
    random_search = RandomizedSearchCV(
        tuned_pipe,
        param_distributions=param_dist,
        n_iter=5,
        cv=3,
        random_state=RANDOM_STATE,
    )
    random_search.fit(X_train, y_train)

    final_model = random_search.best_estimator_
    print(f"Best Parameters: {random_search.best_params_}")

    perm_importance = permutation_importance(
        final_model,
        X_test,
        y_test,
        random_state=RANDOM_STATE,
        scoring="roc_auc",
    )
    importance_df = pd.DataFrame(
        {"Feature": X.columns, "Importance": perm_importance.importances_mean}
    ).sort_values(by="Importance", ascending=False).head(10)
    print("Top 10 Features (Permutation Importance, scorer=roc_auc):")
    print(importance_df)

    y_pred = final_model.predict(X_test)
    print("\nConfusion Matrix:")
    print(confusion_matrix(y_test, y_pred))
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

    out_main = os.path.join(BASE_DIR, MODEL_FILENAME)
    joblib.dump(final_model, out_main)
    print(f"\nSaved: {out_main}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"model_{ts}.joblib"
    archive_path = os.path.join(archive_dir, archive_name)
    shutil.copy2(out_main, archive_path)
    print(f"Archived: {archive_path}")

    new_data = X_test.iloc[[0]].copy()
    prediction = final_model.predict(new_data)
    probability = final_model.predict_proba(new_data)[0, 1]
    print(
        f"Prediction: {'Fraud' if prediction[0] == 1 else 'Not Fraud'}"
    )
    print(f"Fraud Probability: {probability:.4f}")


if __name__ == "__main__":
    main()
