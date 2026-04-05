/**
 * Batch inference-time mirror of pipeline_sklearn.preprocess_orders_features(..., for_inference=true).
 * Must receive the same columns as jobs/run_inference UNSHIPPED_FEATURES_SQL (excluding order_id).
 */

const TARGET_COL = "is_fraud";

export type FeatureRow = Record<string, unknown>;

function allKeys(rows: FeatureRow[]): string[] {
  const s = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) s.add(k);
  return [...s];
}

function dropColumn(rows: FeatureRow[], feat: string): void {
  for (const r of rows) delete r[feat];
}

/** Rough sklearn dtype labels for basic_wrangling parity. */
function pandasDtype(rows: FeatureRow[], feat: string): "int64" | "float64" | "object" | "empty" {
  const vals = rows.map((r) => r[feat]).filter((v) => !isNullish(v));
  if (vals.length === 0) return "empty";
  if (vals.some((v) => typeof v === "string")) return "object";
  let allInt = true;
  for (const v of vals) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return "object";
    if (!Number.isInteger(n)) allInt = false;
  }
  return allInt ? "int64" : "float64";
}

function isNullish(v: unknown): boolean {
  return v == null || (typeof v === "number" && Number.isNaN(v));
}

function basicWrangling(rows: FeatureRow[]): void {
  if (rows.length === 0) return;
  const features = allKeys(rows);
  const n = rows.length;
  for (const feat of [...features]) {
    const vals = rows.map((r) => r[feat]);
    const missing = vals.filter(isNullish).length;
    if (missing / n >= 0.95) {
      dropColumn(rows, feat);
      continue;
    }
    const unique = new Set(vals.map((v) => (v == null ? "__null__" : String(v)))).size;
    const dt = pandasDtype(rows, feat);
    if ((dt === "int64" || dt === "object") && unique / n >= 0.95) {
      dropColumn(rows, feat);
      continue;
    }
    if (unique === 1) {
      dropColumn(rows, feat);
    }
  }
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function parseUtcDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateFeatures(rows: FeatureRow[], feat: string): void {
  if (rows.length === 0 || !allKeys(rows).includes(feat)) return;
  for (const row of rows) {
    const raw = row[feat];
    const d = parseUtcDate(raw);
    row[`${feat}_year`] = d ? d.getUTCFullYear() : null;
    row[`${feat}_month`] = d ? d.getUTCMonth() + 1 : null;
    row[`${feat}_day`] = d ? d.getUTCDate() : null;
    row[`${feat}_weekday`] = d ? WEEKDAYS[d.getUTCDay()] : null;
    delete row[feat];
  }
}

function sampleSkew(vals: number[]): number {
  const xs = vals.filter((x) => Number.isFinite(x));
  const n = xs.length;
  if (n < 3) return 0;
  let m = 0;
  for (const x of xs) m += x;
  m /= n;
  let m2 = 0;
  let m3 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return 0;
  return m3 / m2 ** 1.5;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function skewCorrect(rows: FeatureRow[], feature: string): void {
  const nums = rows.map((r) => toNum(r[feature]));
  const present = nums.map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0);
  if (present.length === 0) return;
  const xs = present.map((i) => nums[i]!);
  let minVal = xs[0]!;
  for (const x of xs) if (x < minVal) minVal = x;
  const shift = minVal < 0 ? -minVal : 0;
  const none = xs.map((x) => x);
  const shifted = xs.map((x) => x + shift);
  const log1p = shifted.map((x) => Math.log1p(Math.max(0, x)));
  const skNone = Math.abs(sampleSkew(none));
  const skLog = Math.abs(sampleSkew(log1p));
  const useLog = skLog < skNone;
  const newCol = `${feature}_skewfix`;
  for (let i = 0; i < rows.length; i++) {
    const v = toNum(rows[i][feature]);
    if (v == null) {
      rows[i][newCol] = null;
      continue;
    }
    const sh = v + shift;
    rows[i][newCol] = useLog ? Math.log1p(Math.max(0, sh)) : v;
  }
}

function memoryCol(rows: FeatureRow[], feat: string): number {
  let s = 0;
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k === feat) continue;
      const v = r[k];
      if (!isNullish(v)) s++;
    }
  }
  return s;
}

function memoryRows(rows: FeatureRow[], feat: string): number {
  let s = 0;
  for (const r of rows) {
    if (isNullish(r[feat])) continue;
    for (const k of Object.keys(r)) {
      if (!isNullish(r[k])) s++;
    }
  }
  return s;
}

function generateMissingTable(rows: FeatureRow[]): {
  feat: string;
  missing: number;
  column: number;
  rows: number;
}[] {
  const cols = allKeys(rows);
  const out: { feat: string; missing: number; column: number; rows: number }[] = [];
  for (const feat of cols) {
    let missing = 0;
    for (const r of rows) {
      if (isNullish(r[feat])) missing++;
    }
    if (missing > 0) {
      out.push({
        feat,
        missing,
        column: memoryCol(rows, feat),
        rows: memoryRows(rows, feat),
      });
    }
  }
  return out;
}

function dropnaAxis1Cols(rows: FeatureRow[], thresh: number): void {
  const cols = allKeys(rows);
  const keep = new Set<string>();
  for (const c of cols) {
    let nonNull = 0;
    for (const r of rows) {
      if (!isNullish(r[c])) nonNull++;
    }
    if (nonNull >= thresh) keep.add(c);
  }
  for (const r of rows) {
    for (const c of cols) {
      if (!keep.has(c)) delete r[c];
    }
  }
}

function dropnaAxis0Rows(rows: FeatureRow[], thresh: number, orderIds: number[] | null): void {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    let nonNull = 0;
    for (const k of Object.keys(r)) {
      if (!isNullish(r[k])) nonNull++;
    }
    if (nonNull < thresh) {
      rows.splice(i, 1);
      if (orderIds) orderIds.splice(i, 1);
    }
  }
}

function missingDrop(rows: FeatureRow[], label: string, orderIds: number[] | null): void {
  const nRows = rows.length;
  if (nRows === 0) return;
  let nCols = allKeys(rows).length;
  dropnaAxis1Cols(rows, Math.round(0.5 * nRows));
  nCols = allKeys(rows).length;
  dropnaAxis0Rows(rows, Math.round(0.9 * nCols), orderIds);
  if (label) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (isNullish(rows[i][label])) {
        rows.splice(i, 1);
        if (orderIds) orderIds.splice(i, 1);
      }
    }
  }

  while (true) {
    const table = generateMissingTable(rows);
    if (table.length === 0) break;
    const first = table.reduce((a, b) => (a.missing >= b.missing ? a : b));
    if (first.column >= first.rows) {
      dropColumn(rows, first.feat);
    } else {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (isNullish(rows[i][first.feat])) {
          rows.splice(i, 1);
          if (orderIds) orderIds.splice(i, 1);
        }
      }
    }
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base]!;
  return sorted[base]! + rest * (sorted[base + 1]! - sorted[base]!);
}

function cleanOutlier(
  rows: FeatureRow[],
  features: string[],
  method: "remove" | "replace",
  orderIds: number[] | null,
): void {
  for (const feat of features) {
    if (!rows[0] || !(feat in rows[0])) continue;
    const nums = rows.map((r) => toNum(r[feat])).filter((x): x is number => x != null);
    if (nums.length === 0) continue;
    const sk = Math.abs(sampleSkew(nums));
    let minVal: number;
    let maxVal: number;
    if (sk > 1) {
      const sorted = [...nums].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      minVal = q1 - 1.5 * (q3 - q1);
      maxVal = q3 + 1.5 * (q3 - q1);
    } else {
      let m = 0;
      for (const x of nums) m += x;
      m /= nums.length;
      let v = 0;
      for (const x of nums) v += (x - m) ** 2;
      const s = Math.sqrt(v / Math.max(1, nums.length - 1));
      minVal = m - 3 * s;
      maxVal = m + 3 * s;
    }
    if (method === "remove") {
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = toNum(rows[i][feat]);
        if (v != null && (v < minVal || v > maxVal)) {
          rows.splice(i, 1);
          if (orderIds) orderIds.splice(i, 1);
        }
      }
    } else {
      for (const r of rows) {
        const v = toNum(r[feat]);
        if (v == null) continue;
        if (v < minVal) r[feat] = minVal;
        if (v > maxVal) r[feat] = maxVal;
      }
    }
  }
}

function selectNumericColumns(rows: FeatureRow[], exclude: Set<string>): string[] {
  const keys = allKeys(rows);
  const out: string[] = [];
  for (const k of keys) {
    if (exclude.has(k)) continue;
    const vals = rows.map((r) => r[k]);
    let num = 0;
    let any = 0;
    for (const v of vals) {
      if (isNullish(v)) continue;
      any++;
      if (typeof v === "number" && !Number.isNaN(v)) num++;
      else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) num++;
    }
    if (any > 0 && num === any) out.push(k);
  }
  return out;
}

function preprocessOrdersFrame(
  rows: FeatureRow[],
  forInference: boolean,
  orderIds: number[] | null,
): void {
  basicWrangling(rows);
  const dateCols = ["order_datetime", "birthdate", "customer_created_at"];
  for (const c of dateCols) {
    if (rows.length > 0 && allKeys(rows).includes(c)) parseDateFeatures(rows, c);
  }

  let numCols = selectNumericColumns(rows, new Set([TARGET_COL]));
  const numColsForOutlier = [...numCols];
  for (const col of numCols) skewCorrect(rows, col);

  const label = forInference ? "" : TARGET_COL;
  missingDrop(rows, label, orderIds);

  cleanOutlier(rows, numColsForOutlier, forInference ? "replace" : "remove", orderIds);

  if (!rows[0] || !(TARGET_COL in rows[0])) {
    throw new Error(`Expected column ${TARGET_COL} after preprocessing.`);
  }
}

/**
 * Same rows/columns as Python preprocess_orders_features (no order_id column).
 * If `orderIds` is provided (same length as rows), it is updated in place when rows are removed.
 */
export function preprocessOrdersFeatures(
  rows: FeatureRow[],
  forInference = true,
  orderIds?: number[],
): FeatureRow[] {
  const copy = rows.map((r) => ({ ...r }));
  const idBuf = orderIds ? [...orderIds] : null;
  preprocessOrdersFrame(copy, forInference, idBuf);
  if (orderIds && idBuf) {
    orderIds.length = 0;
    orderIds.push(...idBuf);
  }
  return copy.map((r) => {
    const { [TARGET_COL]: _, ...rest } = r;
    return rest;
  });
}
