/**
 * Mirrors sklearn Pipeline(ColumnTransformer + LogisticRegression).predict_proba[:,1]
 * when artifacts/logistic_head.json is produced by pipeline_sklearn.py.
 */
export type LogisticSlot =
  | { t: "n"; c: string; med: number; mu: number; sd: number }
  | { t: "c"; c: string; eq: string };

export type LogisticHead = {
  version: number;
  intercept: number;
  coef: number[];
  slots: LogisticSlot[];
};

export function fraudProbFromLogisticHead(
  row: Record<string, unknown>,
  head: LogisticHead,
): number {
  let z = head.intercept;
  for (let i = 0; i < head.slots.length; i++) {
    const s = head.slots[i];
    const w = head.coef[i];
    if (s.t === "n") {
      let v = Number(row[s.c]);
      if (!Number.isFinite(v)) v = s.med;
      z += w * ((v - s.mu) / s.sd);
    } else {
      const val = String(row[s.c] ?? "");
      z += w * (val === s.eq ? 1 : 0);
    }
  }
  const p = 1 / (1 + Math.exp(-z));
  return Math.min(1, Math.max(0, p));
}
