import { getSessionContext } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { renderWaybill } from "@/server/pdf/WaybillPdf";
import { getTransfer } from "@/server/services/transfer.service";

const STATUS_BY_CODE: Record<AppError["code"], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
};

/** Transfer waybill PDF. Same access rules as the transfer page; only shipped transfers have a waybill. */
export async function GET(_request: Request, { params }: RouteContext<"/api/pdf/waybill/[id]">) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Sign in to view this waybill.", { status: 401 });
  const { id } = await params;
  try {
    const transfer = await getTransfer(ctx, id);
    if (transfer.status === "DRAFT" || transfer.status === "CANCELLED") {
      return new Response("A waybill is available once the transfer is shipped.", { status: 409 });
    }
    const pdf = await renderWaybill(transfer);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="waybill-${transfer.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: STATUS_BY_CODE[error.code] });
    throw error;
  }
}
