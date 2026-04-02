# Shop Ops — Part 1 (IS455 / Chapter 17)

Next.js (App Router) + **Supabase (Postgres)** + optional Python batch scoring. Designed to deploy on **Vercel** with Supabase as the system-of-record database.

## 1. Create the database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the migration in `supabase/migrations/20260402120000_shop_schema.sql` (copy/paste the file contents, run once).
3. **Settings → Database → Connection string**  
   - Choose **URI**.  
   - For **Vercel**, use the **Transaction pooler** / port **6543** string (PgBouncer).  
   - Replace `[YOUR-PASSWORD]` with your database password.

## 2. Copy `shop.db` into Supabase (sample + all tables)

Do this **after** step 1 so the empty tables exist.

### Why two different connection strings?

- **One-time data import** (`migrate_sqlite_to_supabase.py`): use Supabase’s **direct** Postgres URI (host like `db.<project-ref>.supabase.co`, port **5432** / “Session mode”). Bulk inserts are more reliable than going through the **transaction pooler** (port **6543**).
- **Your Next.js app** (local + Vercel): use the **transaction pooler** URI (port **6543**). The app is configured for PgBouncer (`prepare: false`).

Both strings use the same **database password** from when you created the project.

### Import steps (Windows PowerShell)

From the `shop-app` folder:

```powershell
cd C:\path\to\Deployment\shop-app
py -m pip install "psycopg[binary]"
$env:DATABASE_URL = "postgresql://postgres.<REF>:<YOUR_PASSWORD>@db.<REF>.supabase.co:5432/postgres"
python scripts\migrate_sqlite_to_supabase.py C:\path\to\Deployment\shop.db
```

Paste the **direct** URI from Supabase (**Project Settings → Database → Connection string**), with your real password. The script prints row counts per table, then fixes SERIAL sequences so new inserts get correct IDs.

`order_predictions` is left empty until you run **Run scoring** in the app (or your ML job).

### Import steps (macOS / Linux)

```bash
pip install "psycopg[binary]"
export DATABASE_URL="postgresql://postgres.<REF>:<YOUR_PASSWORD>@db.<REF>.supabase.co:5432/postgres"
python scripts/migrate_sqlite_to_supabase.py /path/to/shop.db
```

## 3. Local Next.js

```bash
cd shop-app
npm install
copy .env.example .env.local
# Edit .env.local — set DATABASE_URL to the **pooler** URI (:6543) for day-to-day dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 4. Deploy on Vercel

1. Push the repo (or import the `shop-app` folder as the Vercel root directory).
2. In the Vercel project **Settings → Environment Variables**, add:
   - `DATABASE_URL` = your **pooled** Postgres URI (`…pooler.supabase.com:6543…`), with `?sslmode=require` if your client string includes it.
3. Deploy. The `postgres` client uses `prepare: false` so it works with Supabase’s transaction pooler.

**Python scoring on Vercel:** serverless Node **often cannot** run `python jobs/run_inference.py`. If that fails, **Run scoring** automatically falls back to the TypeScript heuristic (same logic as the Python stub). For production Python + joblib, run the job on a small worker (GitHub Action, Railway, etc.) or extend the TS path when you export ONNX, etc.

## Features

| Route | Purpose |
| --- | --- |
| `/select-customer` | Pick customer (cookie); no login |
| `/dashboard` | Summary for selected customer |
| `/place-order` | Inserts `orders` + `order_items` |
| `/orders` | Customer history |
| `/admin/orders` | Admin view of all orders |
| `/warehouse/priority` | Unshipped orders by fraud probability |
| `/scoring` | Triggers scoring (`POST /api/scoring`) |
| `/debug/schema` | `information_schema` introspection |

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Postgres URI (pooler recommended on Vercel) |
| `PYTHON_PATH` | No | Python executable for `jobs/run_inference.py` |

## Part 2 handoff

Save `artifacts/fraud_model.joblib` and implement real inference in `jobs/run_inference.py` (`score_with_model`). Use the same features as training.
