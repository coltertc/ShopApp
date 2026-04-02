import { getSql } from "@/lib/db";

export default async function DebugSchemaPage() {
  const sql = getSql();
  const tables = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `) as { table_name: string }[];

  const sections: {
    table: string;
    cols: { column_name: string; data_type: string; is_nullable: string }[];
  }[] = [];

  for (const t of tables) {
    const cols = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${t.table_name}
      ORDER BY ordinal_position
    `) as { column_name: string; data_type: string; is_nullable: string }[];
    sections.push({ table: t.table_name, cols });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Database schema (debug)</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Public tables in your Supabase Postgres project — verify columns against your textbook prompts.
        </p>
      </div>
      {sections.map(({ table, cols }) => (
        <section key={table} className="rounded-lg border border-zinc-200 dark:border-zinc-700">
          <h2 className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-800/80">
            {table}
          </h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Nullable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {cols.map((c) => (
                <tr key={c.column_name}>
                  <td className="px-3 py-2 font-mono text-xs">{c.column_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.data_type}</td>
                  <td className="px-3 py-2">{c.is_nullable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
