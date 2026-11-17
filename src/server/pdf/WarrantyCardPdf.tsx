import "server-only";

import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";

import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { formatPhoneDisplay } from "@/lib/phone";
import { publicWarrantyUrl } from "@/server/documents/signed-url";
import { formatCalendar, MM } from "@/server/pdf/common";
import { PDF_MONO, PDF_SANS, registerPdfFonts } from "@/server/pdf/fonts";
import type { WarrantyDocument } from "@/server/services/document.service";

/** Digital warranty certificate, A5 landscape (DESIGN.md §6.3). */

const STATUS_WORDS = { ACTIVE: "Active", EXPIRED: "Expired", VOID: "Void" } as const;

const s = StyleSheet.create({
  page: { padding: 10 * MM, fontFamily: PDF_SANS, fontSize: 9, color: "#09090B" },
  frame: { flex: 1, borderWidth: 1.25, borderColor: "#18181B", borderRadius: 4, padding: 9 * MM, flexDirection: "row", gap: 16 },
  store: { fontSize: 12, fontWeight: 700 },
  title: { fontSize: 22, fontWeight: 700, marginTop: 4, marginBottom: 10 },
  label: { fontSize: 7, color: "#52525B", textTransform: "uppercase", letterSpacing: 0.4 },
  value: { fontSize: 10, marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", paddingRight: 8 },
  mono: { fontFamily: PDF_MONO },
  terms: { fontSize: 6.5, color: "#52525B", marginTop: 8, lineHeight: 1.35 },
  side: { width: 120, alignItems: "center", justifyContent: "space-between" },
});

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, mono ? s.mono : {}]}>{value}</Text>
    </View>
  );
}

function WarrantyCertificate({ card, qr, verifyUrl }: { card: WarrantyDocument; qr: string; verifyUrl: string }) {
  return (
    <Document title={`Warranty ${card.publicId}`} author={STORE.name}>
      <Page size="A5" orientation="landscape" style={s.page}>
        <View style={s.frame}>
          <View style={{ flex: 1 }}>
            <Text style={s.store}>{STORE.name}</Text>
            <Text style={{ fontSize: 7, color: "#52525B" }}>{STORE.contact.address} · {formatPhoneDisplay(STORE.contact.phone)} · {STORE.contact.email}</Text>
            <Text style={s.title}>Warranty Certificate</Text>
            <View style={s.grid}>
              <Field label="Device" value={card.deviceName} />
              <Field label="Specification" value={card.spec || "—"} />
              <Field label={card.imei ? "IMEI" : "Serial number"} value={card.imei ?? card.serialNumber ?? "—"} mono />
              <Field label="Condition" value={CONDITION_LABELS[card.condition]} />
              <Field label="Purchased at" value={`${card.branch.name} · ${formatPhoneDisplay(card.branch.phone)}`} />
              <Field label="Purchase date" value={formatCalendar(card.startsAt)} />
              <Field label="Covered until" value={formatCalendar(card.expiresAt)} />
              <Field label="Status" value={STATUS_WORDS[card.status]} />
            </View>
            <Text style={s.terms}>{card.terms}</Text>
          </View>
          <View style={s.side}>
            <View style={{ alignItems: "center" }}>
              <Image src={qr} style={{ width: 110, height: 110 }} />
              <Text style={[s.label, { marginTop: 4, textAlign: "center" }]}>Scan to verify</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={s.label}>Warranty ID</Text>
              <Text style={[s.mono, { fontSize: 11 }]}>{card.publicId}</Text>
              <Text style={{ fontSize: 6, color: "#71717A", marginTop: 3, textAlign: "center" }}>{verifyUrl.replace(/^https?:\/\//, "")}</Text>
              <Text style={{ fontSize: 6, color: "#71717A", marginTop: 2 }}>Invoice {card.invoiceNumber}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderWarrantyPdf(card: WarrantyDocument): Promise<Buffer> {
  registerPdfFonts();
  const verifyUrl = publicWarrantyUrl(card.publicId);
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  return renderToBuffer(<WarrantyCertificate card={card} qr={qr} verifyUrl={verifyUrl} />);
}
