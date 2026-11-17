import { documentErrorResponse, pdfResponse, rateLimitedResponse, resolveDocumentAccess } from "@/server/documents/access";
import { renderInvoicePdf } from "@/server/pdf/InvoicePdf";
import { getInvoiceDocument, loadInvoiceDocument } from "@/server/services/document.service";

/** A4 invoice PDF for staff (session) or customers (signed link). */
export async function GET(request: Request, { params }: RouteContext<"/api/pdf/invoice/[id]">) {
  const { id } = await params;
  const access = await resolveDocumentAccess("invoice", id, request);
  if (!access) return new Response("This link has expired or isn't valid. Ask the store to resend it.", { status: 401 });
  if (access.via === "rate-limited") return rateLimitedResponse(access.retryAfterSeconds);
  try {
    const invoice = access.via === "session" ? await getInvoiceDocument(access.ctx, id) : await loadInvoiceDocument(id);
    return pdfResponse(await renderInvoicePdf(invoice), `invoice-${invoice.number}.pdf`);
  } catch (error) {
    return documentErrorResponse(error);
  }
}
