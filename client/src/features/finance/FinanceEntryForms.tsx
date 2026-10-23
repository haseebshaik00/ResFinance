import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import type { FinanceOverview } from "../../lib/api/client";
import { currentDate, usdToMinorUnits } from "./money";
import type { useFinanceDashboard } from "./useFinanceDashboard";

type Dashboard = ReturnType<typeof useFinanceDashboard>;

interface FinanceEntryFormsProps {
  dashboard: Dashboard;
  overview: FinanceOverview;
  month: string;
}

const deterministicCategories = [
  { category_id: "salary", name: "Salary", direction: "income" },
  {
    category_id: "liquid-funds-transfer",
    name: "Liquid Funds Transfer",
    direction: "income",
  },
  {
    category_id: "other-sources",
    name: "Other Sources",
    direction: "income",
  },
  { category_id: "rent", name: "Rent", direction: "expense" },
  { category_id: "utilities", name: "Utilities", direction: "expense" },
  { category_id: "shopping", name: "Shopping", direction: "expense" },
  {
    category_id: "entertainment",
    name: "Entertainment",
    direction: "expense",
  },
  {
    category_id: "food-groceries",
    name: "Food & Groceries",
    direction: "expense",
  },
  {
    category_id: "medical-bills",
    name: "Medical Bills",
    direction: "expense",
  },
  {
    category_id: "miscellaneous",
    name: "Miscellaneous",
    direction: "expense",
  },
] as const;

const transactionSchema = z.object({
  direction: z.enum(["income", "expense"]),
  category_id: z.string().min(1, "Choose a category."),
  amount: z.string().refine(validAmount, "Enter a positive USD amount."),
  occurred_on: z.iso.date(),
  description: z.string().trim().min(1, "Enter a description.").max(160),
});

const budgetSchema = z.object({
  category_id: z.string().min(1, "Choose an expense category."),
  amount: z.string().refine(validAmount, "Enter a positive USD amount."),
});

const recurringSchema = transactionSchema.pick({
  direction: true,
  category_id: true,
  amount: true,
  description: true,
});

type TransactionValues = z.infer<typeof transactionSchema>;
type BudgetValues = z.infer<typeof budgetSchema>;
type RecurringValues = z.infer<typeof recurringSchema>;

export function FinanceEntryForms({
  dashboard,
  overview,
  month,
}: FinanceEntryFormsProps) {
  const transaction = useForm<TransactionValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      direction: "expense",
      category_id: "",
      amount: "",
      occurred_on: currentDate(),
      description: "",
    },
  });
  const budget = useForm<BudgetValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: { category_id: "", amount: "" },
  });
  const recurring = useForm<RecurringValues>({
    resolver: zodResolver(recurringSchema),
    defaultValues: {
      direction: "expense",
      category_id: "",
      amount: "",
      description: "",
    },
  });
  const transactionDirection = transaction.watch("direction");
  const recurringDirection = recurring.watch("direction");
  const expenseCategories = deterministicCategories.filter(
    (item) => item.direction === "expense",
  );

  return (
    <section
      className="entry-panel"
      aria-label="Add A Finance Record (Update Your Ledger)"
    >
      <details className="entry-accordion">
        <summary>
          <span id="add-record-title">
            Add A Finance Record (Update Your Ledger)
          </span>
          <small>
            Every saved change appends an encrypted, auditable event.
          </small>
        </summary>
        <div className="entry-grid">
          <section className="entry-form-card transaction-form">
            <h3>Income or expense</h3>
            <form
              onSubmit={transaction.handleSubmit(async (values) => {
                const id = crypto.randomUUID();
                await dashboard.transaction.mutateAsync({
                  idempotencyKey: `transaction-${id}`,
                  body: {
                    transaction_id: `transaction-${id}`,
                    direction: values.direction,
                    category_id: values.category_id,
                    amount: {
                      currency: "USD",
                      minor_units: usdToMinorUnits(values.amount),
                    },
                    occurred_on: values.occurred_on,
                    description: values.description,
                    recurring_entry_id: null,
                    expected_version: overview.provenance.projection_version,
                  },
                });
                transaction.reset({
                  direction: values.direction,
                  category_id: "",
                  amount: "",
                  occurred_on: currentDate(),
                  description: "",
                });
              })}
            >
              <div className="form-row">
                <Field
                  label="Type"
                  error={transaction.formState.errors.direction?.message}
                >
                  <select
                    {...transaction.register("direction", {
                      onChange: () => transaction.setValue("category_id", ""),
                    })}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </Field>
                <CategoryField
                  label="Category"
                  categories={deterministicCategories.filter(
                    (item) => item.direction === transactionDirection,
                  )}
                  registration={transaction.register("category_id")}
                  error={transaction.formState.errors.category_id?.message}
                />
              </div>
              <div className="form-row">
                <Field
                  label="Amount in USD"
                  error={transaction.formState.errors.amount?.message}
                >
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    {...transaction.register("amount")}
                  />
                </Field>
                <Field
                  label="Date"
                  error={transaction.formState.errors.occurred_on?.message}
                >
                  <input type="date" {...transaction.register("occurred_on")} />
                </Field>
              </div>
              <Field
                label="Description"
                error={transaction.formState.errors.description?.message}
              >
                <input
                  autoComplete="off"
                  {...transaction.register("description")}
                />
              </Field>
              <SubmitButton
                pending={dashboard.transaction.isPending}
                tone="transaction"
              >
                Save transaction
              </SubmitButton>
              <MutationError error={dashboard.transaction.error} />
            </form>
          </section>

          <section className="entry-form-card budget-form">
            <h3>Monthly budget</h3>
            <form
              onSubmit={budget.handleSubmit(async (values) => {
                const id = `${month}-${values.category_id}`;
                await dashboard.budget.mutateAsync({
                  idempotencyKey: `budget-${crypto.randomUUID()}`,
                  body: {
                    budget_id: `budget-${id}`,
                    category_id: values.category_id,
                    month,
                    limit: {
                      currency: "USD",
                      minor_units: usdToMinorUnits(values.amount),
                    },
                    expected_version: overview.provenance.projection_version,
                  },
                });
                budget.reset();
              })}
            >
              <CategoryField
                label="Expense category"
                categories={expenseCategories}
                registration={budget.register("category_id")}
                error={budget.formState.errors.category_id?.message}
              />
              <Field
                label="Monthly limit in USD"
                error={budget.formState.errors.amount?.message}
              >
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  {...budget.register("amount")}
                />
              </Field>
              <SubmitButton
                pending={dashboard.budget.isPending}
                disabled={expenseCategories.length === 0}
                tone="budget"
              >
                Save budget
              </SubmitButton>
              <MutationError error={dashboard.budget.error} />
            </form>
          </section>

          <section className="entry-form-card recurring-form">
            <h3>Monthly recurring item</h3>
            <form
              onSubmit={recurring.handleSubmit(async (values) => {
                const id = crypto.randomUUID();
                await dashboard.recurring.mutateAsync({
                  idempotencyKey: `recurring-${id}`,
                  body: {
                    recurring_entry_id: `recurring-${id}`,
                    direction: values.direction,
                    category_id: values.category_id,
                    amount: {
                      currency: "USD",
                      minor_units: usdToMinorUnits(values.amount),
                    },
                    description: values.description,
                    cadence: "monthly",
                    starts_on: `${month}-01`,
                    ends_on: null,
                    expected_version: overview.provenance.projection_version,
                  },
                });
                recurring.reset({
                  direction: values.direction,
                  category_id: "",
                  amount: "",
                  description: "",
                });
              })}
            >
              <div className="form-row">
                <Field
                  label="Type"
                  error={recurring.formState.errors.direction?.message}
                >
                  <select
                    {...recurring.register("direction", {
                      onChange: () => recurring.setValue("category_id", ""),
                    })}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </Field>
                <CategoryField
                  label="Category"
                  categories={deterministicCategories.filter(
                    (item) => item.direction === recurringDirection,
                  )}
                  registration={recurring.register("category_id")}
                  error={recurring.formState.errors.category_id?.message}
                />
              </div>
              <Field
                label="Amount in USD"
                error={recurring.formState.errors.amount?.message}
              >
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  {...recurring.register("amount")}
                />
              </Field>
              <Field
                label="Description"
                error={recurring.formState.errors.description?.message}
              >
                <input
                  autoComplete="off"
                  {...recurring.register("description")}
                />
              </Field>
              <SubmitButton
                pending={dashboard.recurring.isPending}
                tone="recurring"
              >
                Save recurring item
              </SubmitButton>
              <MutationError error={dashboard.recurring.error} />
            </form>
          </section>
        </div>
      </details>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {error !== undefined && <small className="field-error">{error}</small>}
    </label>
  );
}

function CategoryField({
  label,
  categories,
  registration,
  error,
}: {
  label: string;
  categories: readonly {
    category_id: string;
    name: string;
  }[];
  registration: UseFormRegisterReturn;
  error?: string | undefined;
}) {
  return (
    <Field label={label} error={error}>
      <select {...registration}>
        <option value="">Choose category</option>
        {categories.map((category) => (
          <option key={category.category_id} value={category.category_id}>
            {category.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SubmitButton({
  pending,
  disabled = false,
  tone,
  children,
}: {
  pending: boolean;
  disabled?: boolean;
  tone: "transaction" | "budget" | "recurring";
  children: React.ReactNode;
}) {
  return (
    <button
      className={`primary-button form-action ${tone}`}
      type="submit"
      disabled={pending || disabled}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function MutationError({ error }: { error: Error | null }) {
  return error === null ? null : (
    <p className="form-error" role="alert">
      {error.message}
    </p>
  );
}

function validAmount(value: string): boolean {
  try {
    usdToMinorUnits(value);
    return true;
  } catch {
    return false;
  }
}
