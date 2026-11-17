import type { Prisma } from "@/generated/prisma/client";

export type DocumentKind = "INVOICE" | "TRANSFER" | "PURCHASE_ORDER" | "RETURN";

const PREFIX: Record<DocumentKind, string> = {
  INVOICE: "INV",
  TRANSFER: "TRF",
  PURCHASE_ORDER: "PO",
  RETURN: "RTN",
};

const SEQUENCE_DIGITS = 6;

/** INV-IKJ-000123 */
export function formatDocumentNumber(kind: DocumentKind, branchCode: string, sequence: number): string {
  return `${PREFIX[kind]}-${branchCode}-${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
}

/**
 * Allocates the next document number for a branch. Must run inside the transaction that creates
 * the document: the UPDATE takes a row lock on the branch until commit, so concurrent checkouts
 * at the same branch serialise here, and a rolled-back transaction rolls the counter back too —
 * numbers stay gapless per branch (invariant 10).
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  kind: DocumentKind,
): Promise<string> {
  switch (kind) {
    case "INVOICE": {
      const b = await tx.branch.update({
        where: { id: branchId },
        data: { invoiceSequence: { increment: 1 } },
        select: { code: true, invoiceSequence: true },
      });
      return formatDocumentNumber(kind, b.code, b.invoiceSequence);
    }
    case "TRANSFER": {
      const b = await tx.branch.update({
        where: { id: branchId },
        data: { transferSequence: { increment: 1 } },
        select: { code: true, transferSequence: true },
      });
      return formatDocumentNumber(kind, b.code, b.transferSequence);
    }
    case "PURCHASE_ORDER": {
      const b = await tx.branch.update({
        where: { id: branchId },
        data: { purchaseOrderSequence: { increment: 1 } },
        select: { code: true, purchaseOrderSequence: true },
      });
      return formatDocumentNumber(kind, b.code, b.purchaseOrderSequence);
    }
    case "RETURN": {
      const b = await tx.branch.update({
        where: { id: branchId },
        data: { returnSequence: { increment: 1 } },
        select: { code: true, returnSequence: true },
      });
      return formatDocumentNumber(kind, b.code, b.returnSequence);
    }
  }
}
