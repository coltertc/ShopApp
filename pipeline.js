#!/usr/bin/env node
/**
 * Runs pipeline_sklearn.py to train and save Joblib models only:
 *   - models.joblib (latest)
 *   - joblib/model_<YYYYMMDD_HHMMSS>.joblib (archive per run)
 *
 * Requires Python 3 and requirements.txt. Set DATABASE_URL to your Supabase Postgres
 * URI (same as the web app). If DATABASE_URL is unset, uses SQLite shop.db or SHOP_DB_PATH.
 * Nightly GitHub Actions run this script; jobs/run_inference.py loads models.joblib for scoring.
 *
 * Usage: node pipeline.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const scriptDir = __dirname;
const pyScript = path.join(scriptDir, 'pipeline_sklearn.py');

const attempts = [
  ['python', [pyScript]],
  ['python3', [pyScript]],
  ['py', ['-3', pyScript]],
];

function runPython() {
  const env = {
    ...process.env,
    PYTHONUTF8: '1',
  };

  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, {
      cwd: scriptDir,
      stdio: 'inherit',
      env,
      shell: false,
    });
    if (r.error) {
      if (r.error.code === 'ENOENT') continue;
      console.error(r.error);
      return 1;
    }
    if (r.signal) return 1;
    return typeof r.status === 'number' ? r.status : 0;
  }

  console.error(
    'Python was not found. Install Python 3 (see requirements.txt) and ensure ' +
      '`python`, `python3`, or `py` is on PATH.'
  );
  return 1;
}

process.exit(runPython());
