import { getSessionContext } from "@/server/auth/session";
import { documentErrorResponse } from "@/server/documents/access";
import { exportCustomerData } from "@/server/services/privacy.service";

/** Owner: everything held on one customer as a JSON download (NDPA access request). Audited. */
export async function GET(_request: Request, { params }: RouteContext<"/api/customers/[id]/export">) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  try {
    const data = await exportCustomerData(ctx, id);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-data-${id.slice(0, 8)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
