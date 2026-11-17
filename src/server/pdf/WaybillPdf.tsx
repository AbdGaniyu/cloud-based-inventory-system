import "server-only";

import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import bwipjs from "bwip-js/node";

import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { formatPhoneDisplay } from "@/lib/phone";
import type { TransferDetail } from "@/server/services/transfer.service";

/** Transfer waybill / manifest (DESIGN.md §6.4). Always light: black on white, one thin rule. */

const MM = 2.835; // points per millimetre
const STATUS: Record<TransferDetail["status"], string> = { DRAFT: "Draft", IN_TRANSIT: "In transit", RECEIVED: "Received", CANCELLED: "Cancelled" };
const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: STORE.timezone });

const s = StyleSheet.create({
  page: { paddingTop: 18 * MM, paddingBottom: 22 * MM, paddingHorizontal: 18 * MM, fontFamily: "Helvetica", fontSize: 9, color: "#09090B" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  store: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "right" },
  muted: { color: "#52525B" },
  mono: { fontFamily: "Courier" },
  rule: { borderBottomWidth: 1, borderBottomColor: "#18181B", marginVertical: 10 },
  blocks: { flexDirection: "row", gap: 16, marginBottom: 10 },
  block: { flex: 1, borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3, padding: 8 },
  label: { fontSize: 7, color: "#52525B", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  blockName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 12 },
  table: { borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E4E4E7", paddingVertical: 4, paddingHorizontal: 6 },
  headRow: { backgroundColor: "#F4F4F5" },
  th: { fontSize: 7, color: "#52525B", textTransform: "uppercase", letterSpacing: 0.4 },
  cNum: { width: 18 },
  cProduct: { flex: 1, paddingRight: 6 },
  cId: { width: 120 },
  cCond: { width: 62 },
  cQty: { width: 32, textAlign: "right" },
  totals: { flexDirection: "row", justifyContent: "flex-end", gap: 16, marginTop: 6 },
  signatures: { flexDirection: "row", gap: 12, marginTop: 24 },
  signature: { flex: 1, borderWidth: 0.75, borderColor: "#D4D4D8", borderRadius: 3, padding: 8 },
  line: { borderBottomWidth: 0.75, borderBottomColor: "#71717A", height: 18, marginBottom: 2 },
  footer: { position: "absolute", bottom: 10 * MM, left: 18 * MM, right: 18 * MM, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#71717A" },
});

function SignatureBlock({ title, name }: { title: string; name?: string | null }) {
  return (
    <View style={s.signature} wrap={false}>
      <Text style={s.label}>{title}</Text>
      {["Name", "Signature", "Date"].map((field) => (
        <View key={field} style={{ marginTop: 6 }}>
          <View style={s.line}>{field === "Name" && name ? <Text style={{ paddingTop: 6 }}>{name}</Text> : null}</View>
          <Text style={[s.muted, { fontSize: 7 }]}>{field}</Text>
        </View>
      ))}
    </View>
  );
}

function WaybillDocument({ transfer, barcode }: { transfer: TransferDetail; barcode: Buffer }) {
  const received = transfer.status === "RECEIVED";
  return (
    <Document title={`Waybill ${transfer.number}`} author={STORE.name} subject="Stock transfer waybill">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.store}>{STORE.name}</Text>
            <Text style={s.muted}>Stock transfer waybill / manifest</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.title}>WAYBILL</Text>
            <Text style={[s.mono, { fontSize: 11 }]}>{transfer.number}</Text>
            <Image src={{ data: barcode, format: "png" }} style={{ width: 120, height: 22, marginTop: 4 }} />
            <Text style={[s.muted, { marginTop: 3 }]}>
              {STATUS[transfer.status]} · {dateTime.format(new Date(transfer.shippedAt ?? transfer.createdAt))}
            </Text>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.blocks}>
          {[
            { title: "Dispatched from", branch: transfer.from },
            { title: "Deliver to", branch: transfer.to },
          ].map(({ title, branch }) => (
            <View key={title} style={s.block}>
              <Text style={s.label}>{title}</Text>
              <Text style={s.blockName}>
                {branch.name} <Text style={[s.mono, s.muted, { fontSize: 9 }]}>{branch.code}</Text>
              </Text>
              <Text>{branch.address}</Text>
              <Text style={s.muted}>{formatPhoneDisplay(branch.phone)}</Text>
            </View>
          ))}
        </View>

        <View style={s.meta}>
          <Text>
            <Text style={s.muted}>Driver: </Text>
            {transfer.driverName ?? "________________"}
          </Text>
          <Text>
            <Text style={s.muted}>Prepared by: </Text>
            {transfer.createdBy}
          </Text>
          {transfer.shippedBy && (
            <Text>
              <Text style={s.muted}>Shipped by: </Text>
              {transfer.shippedBy}
            </Text>
          )}
          {transfer.receivedBy && (
            <Text>
              <Text style={s.muted}>Received by: </Text>
              {transfer.receivedBy}
            </Text>
          )}
        </View>

        <View style={s.table}>
          <View style={[s.row, s.headRow]} fixed>
            <Text style={[s.th, s.cNum]}>#</Text>
            <Text style={[s.th, s.cProduct]}>Product</Text>
            <Text style={[s.th, s.cId]}>IMEI / serial</Text>
            <Text style={[s.th, s.cCond]}>Condition</Text>
            <Text style={[s.th, s.cQty]}>Qty</Text>
            {received && <Text style={[s.th, s.cQty]}>Recv.</Text>}
          </View>
          {transfer.items.map((item, index) => (
            <View key={item.id} style={s.row} wrap={false}>
              <Text style={[s.cNum, s.muted]}>{index + 1}</Text>
              <View style={s.cProduct}>
                <Text>{item.productName}</Text>
                {item.discrepancyNote && <Text style={[s.muted, { fontSize: 7 }]}>Note: {item.discrepancyNote}</Text>}
              </View>
              <Text style={[s.cId, s.mono]}>{item.identifier ?? item.sku}</Text>
              <Text style={s.cCond}>{item.condition ? CONDITION_LABELS[item.condition] : "—"}</Text>
              <Text style={s.cQty}>{item.quantity}</Text>
              {received && <Text style={s.cQty}>{item.receivedQuantity ?? "—"}</Text>}
            </View>
          ))}
        </View>
        <View style={s.totals}>
          <Text>
            <Text style={s.muted}>Devices: </Text>
            {transfer.totals.devices}
          </Text>
          <Text>
            <Text style={s.muted}>Accessories: </Text>
            {transfer.totals.accessoryQuantity}
          </Text>
          <Text>
            <Text style={s.muted}>Lines: </Text>
            {transfer.totals.lines}
          </Text>
        </View>

        <View style={s.signatures}>
          <SignatureBlock title="Dispatched by" name={transfer.shippedBy} />
          <SignatureBlock title="Carried by" name={transfer.driverName} />
          <SignatureBlock title="Received by" name={transfer.receivedBy} />
        </View>

        <View style={s.footer} fixed>
          <Text>
            {STORE.name} · {transfer.number}
            {transfer.status === "IN_TRANSIT" ? " · Items on this waybill are locked from sale until received." : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderWaybill(transfer: TransferDetail): Promise<Buffer> {
  const barcode = await bwipjs.toBuffer({ bcid: "code128", text: transfer.number, scale: 3, height: 8, includetext: false });
  return renderToBuffer(<WaybillDocument transfer={transfer} barcode={barcode} />);
}
