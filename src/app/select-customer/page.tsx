import { selectCustomerAction } from "@/app/actions";
import { getSql } from "@/lib/db";

import { CustomerPicker } from "./ui";

export default async function SelectCustomerPage() {
  const sql = getSql();
  const customers = (await sql`
    SELECT customer_id, full_name, email FROM customers
    WHERE is_active = 1
    ORDER BY full_name
  `) as { customer_id: number; full_name: string; email: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Select customer
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          No login for this lab — pick an existing customer to place orders and view history.
        </p>
      </div>
      <CustomerPicker customers={customers} formAction={selectCustomerAction} />
    </div>
  );
}
