import "server-only";

import postgres from "postgres";

declare global {
  var __shopPostgres: ReturnType<typeof postgres> | undefined;
}

function createSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase Postgres URI (Settings → Database → Connection string → URI, use the pooler on port 6543 for Vercel).",
    );
  }

  return postgres(url, {
    ssl: "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    // Required for Supabase transaction pooler (PgBouncer)
    prepare: false,
  });
}

/** Supabase-compatible Postgres client (server-only). */
export function getSql() {
  if (!globalThis.__shopPostgres) {
    globalThis.__shopPostgres = createSql();
  }
  return globalThis.__shopPostgres;
}

export async function ensureOrderPredictionsTable() {
  await getSql()`
    CREATE TABLE IF NOT EXISTS order_predictions (
      order_id INTEGER PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
      fraud_probability DOUBLE PRECISION NOT NULL,
      predicted_fraud INTEGER NOT NULL,
      prediction_timestamp TEXT NOT NULL
    );
  `;
}
