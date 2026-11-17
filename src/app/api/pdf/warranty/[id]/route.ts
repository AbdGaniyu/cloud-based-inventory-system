import { documentErrorResponse, pdfResponse, rateLimitedResponse, resolveDocumentAccess } from "@/server/documents/access";
import { renderWarrantyPdf } from "@/server/pdf/WarrantyCardPdf";
import { getWarrantyDocument, loadWarrantyDocument } from "@/server/services/document.service";

/** Warranty certificate PDF (A5 landscape) for staff (session) or customers (signed link). */
export async function GET(request: Request, { params }: RouteContext<"/api/pdf/warranty/[id]">) {
  const { id } = await params;
  const access = await resolveDocumentAccess("warranty", id, request);
  if (!access) return new Response("This link has expired or isn't valid. Ask the store to resend it.", { status: 401 });
  if (access.via === "rate-limited") return rateLimitedResponse(access.retryAfterSeconds);
  try {
    const card = access.via === "session" ? await getWarrantyDocument(access.ctx, id) : await loadWarrantyDocument(id);
    return pdfResponse(await renderWarrantyPdf(card), `warranty-${card.publicId}.pdf`);
  } catch (error) {
    return documentErrorResponse(error);
  }
}
