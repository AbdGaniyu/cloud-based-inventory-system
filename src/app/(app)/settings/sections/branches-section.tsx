"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { addBranch, editBranch } from "@/app/(app)/settings/actions";
import { CloseBranchDialog } from "@/app/(app)/settings/sections/close-branch-dialog";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { formatPhoneDisplay } from "@/lib/phone";
import type { AdminBranch } from "@/server/services/admin.service";

type Draft = { id?: string; name: string; code: string; type: "STORE" | "WAREHOUSE"; address: string; phone: string; email: string; isActive: boolean };
const EMPTY: Draft = { name: "", code: "", type: "STORE", address: "", phone: "", email: "", isActive: true };

function BranchDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const { save, pending, error, fieldError } = useSave();
  const editing = Boolean(draft.id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fields = { name: d.name, type: d.type, address: d.address, phone: d.phone, email: d.email };
            if (d.id) save(() => editBranch({ id: d.id, ...fields, isActive: d.isActive }), "Branch saved", onClose);
            else save(() => addBranch({ ...fields, code: d.code }), "Branch added", onClose);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${draft.name}` : "Add a branch"}</DialogTitle>
            <DialogDescription>{editing ? "The code stays fixed: it is in every document number." : "The code becomes the prefix of its invoice, transfer and return numbers."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
            <LabeledField label="Name" error={fieldError("name")}>
              <Input value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </LabeledField>
            <LabeledField label="Code" error={fieldError("code")} hint={editing ? undefined : "e.g. VI"}>
              <Input value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} disabled={editing} maxLength={5} className="font-mono uppercase" />
            </LabeledField>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium">Type</span>
            <Segmented label="Branch type" value={d.type} onChange={(t) => set("type", t)} options={[{ value: "STORE", label: "Store (sells)" }, { value: "WAREHOUSE", label: "Warehouse" }]} />
          </div>
          <LabeledField label="Address" error={fieldError("address")}>
            <Input value={d.address} onChange={(e) => set("address", e.target.value)} />
          </LabeledField>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Phone" error={fieldError("phone")}>
              <Input value={d.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" />
            </LabeledField>
            <LabeledField label="Email (optional)" error={fieldError("email")}>
              <Input value={d.email} onChange={(e) => set("email", e.target.value)} type="email" />
            </LabeledField>
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <label htmlFor="branch-open" className="text-body">Open for business</label>
              <Switch id="branch-open" checked={d.isActive} onCheckedChange={(v) => set("isActive", v)} />
            </div>
          )}
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {editing ? "Save" : "Add branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BranchesSection({ branches }: { branches: AdminBranch[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  return (
    <section aria-labelledby="branches-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 id="branches-heading" className="text-h2">Branches</h2>
        <Button type="button" onClick={() => setDraft(EMPTY)}>
          <Plus aria-hidden data-icon="inline-start" /> Add branch
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-small">
          <caption className="sr-only">Branches</caption>
          <thead className="bg-surface text-caption text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th scope="col" className="h-10 px-3 text-left font-medium">Branch</th>
              <th scope="col" className="px-3 text-left font-medium">Contact</th>
              <th scope="col" className="px-3 text-right font-medium">Staff</th>
              <th scope="col" className="px-3 text-right font-medium">Devices</th>
              <th scope="col" className="px-3 text-right font-medium">Invoices</th>
              <th scope="col" className="px-3 text-left font-medium">Status</th>
              <th scope="col" className="px-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5">
                  <p className="text-body font-medium">{b.name}</p>
                  <p className="text-muted-foreground"><span className="font-mono">{b.code}</span> · {b.type === "STORE" ? "Store" : "Warehouse"}</p>
                </td>
                <td className="px-3">
                  <p>{b.address}</p>
                  <p className="text-muted-foreground">{formatPhoneDisplay(b.phone)}{b.email ? ` · ${b.email}` : ""}</p>
                </td>
                <td className="px-3 text-right tabular-nums">{b.staff}</td>
                <td className="px-3 text-right tabular-nums">{b.devicesInStock}</td>
                <td className="px-3 text-right tabular-nums">{b.invoices}</td>
                <td className="px-3">{b.isActive ? <Badge tone="success">Open</Badge> : <Badge tone="neutral">Closed</Badge>}</td>
                <td className="px-3 text-right whitespace-nowrap">
                  {b.isActive && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(b.id)} aria-label={`Close ${b.name}`}>
                      Close…
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ id: b.id, name: b.name, code: b.code, type: b.type, address: b.address, phone: b.phone, email: b.email ?? "", isActive: b.isActive })}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && <BranchDialog draft={draft} onClose={() => setDraft(null)} />}
      {closing && <CloseBranchDialog branchId={closing} onClose={() => setClosing(null)} />}
    </section>
  );
}
