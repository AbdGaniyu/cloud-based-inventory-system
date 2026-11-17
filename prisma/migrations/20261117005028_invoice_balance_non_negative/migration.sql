-- An invoice can never be overpaid: payments beyond the open balance are rejected
-- (installment overpayment only rolls forward within the remaining balance).
-- Voided invoices are excluded because their balance is informational only.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_balance_non_negative_check"
  CHECK (status = 'VOID' OR balance >= 0);
