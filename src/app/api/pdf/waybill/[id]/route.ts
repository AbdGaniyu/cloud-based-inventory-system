import { getSessionContext } from "@/server/auth/session";
import { documentErrorResponse, pdfResponse } from "@/server/documents/access";
import { renderWaybill } from "@/server/pdf/WaybillPdf";
import { getTransfer } from "@/server/services/transfer.service";

/** Transfer waybill PDF. Staff only, same access rules as the transfer page; only shipped transfers have a waybill. */
export async function GET(_request: Request, { params }: RouteContext<"/api/pdf/waybill/[id]">) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Sign in to view this waybill.", { status: 401 });
  const { id } = await params;
  try {
    const transfer = await getTransfer(ctx, id);
    if (transfer.status === "DRAFT" || transfer.status === "CANCELLED") {
      return new Response("A waybill is available once the transfer is shipped.", { status: 409 });
    }
    return pdfResponse(await renderWaybill(transfer), `waybill-${transfer.number}.pdf`);
  } catch (error) {
    return documentErrorResponse(error);
  }
}
