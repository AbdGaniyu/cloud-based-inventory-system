"use client";

import { KeyRound, Loader2, Plus, ShieldOff } from "lucide-react";
import { useState } from "react";

import { addUser, clearUserTwoFactor, editUser, setUserPassword } from "@/app/(app)/settings/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { PASSWORD_MIN } from "@/lib/validators/settings";
import type { AdminBranch, AdminUser } from "@/server/services/admin.service";

type Role = "OWNER" | "BRANCH_MANAGER" | "CASHIER";
const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", BRANCH_MANAGER: "Branch manager", CASHIER: "Cashier" };
const lastSeen = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

type Draft = { id?: string; name: string; email: string; role: Role; branchId: string; isActive: boolean; password: string };

function UserDialog({ draft, branches, onClose, isSelf }: { draft: Draft; branches: AdminBranch[]; onClose: () => void; isSelf: boolean }) {
  const [d, setD] = useState(draft);
  const { save, pending, error, fieldError } = useSave();
  const editing = Boolean(draft.id);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const open = branches.filter((b) => b.isActive);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const branchId = d.role === "OWNER" ? undefined : d.branchId || undefined;
            if (d.id) save(() => editUser({ id: d.id, name: d.name, role: d.role, branchId, isActive: d.isActive }), "User saved", onClose);
            else save(() => addUser({ name: d.name, email: d.email, role: d.role, branchId, password: d.password }), "User added", onClose);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${draft.name}` : "Add a user"}</DialogTitle>
            <DialogDescription>Owners see every branch. Managers and cashiers work at one branch.</DialogDescription>
          </DialogHeader>
          <LabeledField label="Name" error={fieldError("name")}>
            <Input value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </LabeledField>
          <LabeledField label="Email (sign-in)" error={fieldError("email")}>
            <Input type="email" value={d.email} onChange={(e) => set("email", e.target.value)} disabled={editing} />
          </LabeledField>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="Role" error={fieldError("role")}>
              <Select value={d.role} onValueChange={(r) => set("role", r as Role)} disabled={isSelf}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </LabeledField>
            {d.role !== "OWNER" && (
              <LabeledField label="Branch" error={fieldError("branchId")}>
                <Select value={d.branchId} onValueChange={(b) => set("branchId", b)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {open.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </LabeledField>
            )}
          </div>
          {!editing && (
            <LabeledField label="Temporary password" hint={`At least ${PASSWORD_MIN} characters. Share it privately.`} error={fieldError("password")}>
              <Input type="text" autoComplete="off" value={d.password} onChange={(e) => set("password", e.target.value)} />
            </LabeledField>
          )}
          {editing && !isSelf && (
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <label htmlFor="user-active" className="text-body">Can sign in</label>
              <Switch id="user-active" checked={d.isActive} onCheckedChange={(v) => set("isActive", v)} />
            </div>
          )}
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {editing ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const { save, pending, error, fieldError } = useSave();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); save(() => setUserPassword({ id: user.id, password }), `New password set for ${user.name}`, onClose); }} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>A temporary password: {user.name} is signed out everywhere, signs in with this once and then chooses their own. Any sign-in lockout is cleared.</DialogDescription>
          </DialogHeader>
          <LabeledField label="New password" hint={`At least ${PASSWORD_MIN} characters.`} error={fieldError("password")}>
            <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </LabeledField>
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || password.length < PASSWORD_MIN}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorResetDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { save, pending, error } = useSave();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset two-factor for {user.name}?</DialogTitle>
          <DialogDescription>
            For a lost or replaced phone. Their authenticator and recovery codes stop working and they are signed out everywhere.
            {user.role === "OWNER" ? " They will be asked to set two-factor up again when they next sign in." : " They can set it up again from Account security."}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-small text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => save(() => clearUserTwoFactor({ id: user.id }), `Two-factor reset for ${user.name}`, onClose)}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Reset two-factor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersSection({ users, branches, currentUserId }: { users: AdminUser[]; branches: AdminBranch[]; currentUserId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [clearing2fa, setClearing2fa] = useState<AdminUser | null>(null);
  return (
    <section aria-labelledby="users-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 id="users-heading" className="text-h2">Users and roles</h2>
        <Button type="button" onClick={() => setDraft({ name: "", email: "", role: "CASHIER", branchId: "", isActive: true, password: "" })}>
          <Plus aria-hidden data-icon="inline-start" /> Add user
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-small">
          <caption className="sr-only">Users</caption>
          <thead className="bg-surface text-caption text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th scope="col" className="h-10 px-3 text-left font-medium">Name</th>
              <th scope="col" className="px-3 text-left font-medium">Role</th>
              <th scope="col" className="px-3 text-left font-medium">Branch</th>
              <th scope="col" className="px-3 text-left font-medium">Last sign-in</th>
              <th scope="col" className="px-3 text-left font-medium">Status</th>
              <th scope="col" className="px-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5">
                  <p className="text-body font-medium">{u.name}{u.id === currentUserId ? " (you)" : ""}</p>
                  <p className="text-muted-foreground">{u.email}</p>
                </td>
                <td className="px-3">{ROLE_LABEL[u.role]}</td>
                <td className="px-3">{u.branchName ?? "All branches"}</td>
                <td className="px-3 tabular-nums text-muted-foreground">{u.lastLoginAt ? lastSeen.format(new Date(u.lastLoginAt)) : "Never"}</td>
                <td className="px-3">
                  <span className="flex flex-wrap gap-1">
                    {u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Switched off</Badge>}
                    {u.twoFactorEnabled && <Badge tone="info" dot={false}>2FA on</Badge>}
                    {u.mustChangePassword && <Badge tone="warning" dot={false}>Temporary password</Badge>}
                  </span>
                </td>
                <td className="px-3 text-right whitespace-nowrap">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setResetting(u)} aria-label={`Reset password for ${u.name}`} title="Reset password">
                    <KeyRound aria-hidden />
                  </Button>
                  {u.twoFactorEnabled && u.id !== currentUserId && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setClearing2fa(u)} aria-label={`Reset two-factor for ${u.name}`} title="Reset two-factor">
                      <ShieldOff aria-hidden />
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branchId ?? "", isActive: u.isActive, password: "" })}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && <UserDialog draft={draft} branches={branches} onClose={() => setDraft(null)} isSelf={draft.id === currentUserId} />}
      {resetting && <PasswordDialog user={resetting} onClose={() => setResetting(null)} />}
      {clearing2fa && <TwoFactorResetDialog user={clearing2fa} onClose={() => setClearing2fa(null)} />}
    </section>
  );
}
