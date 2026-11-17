"use client";

import { Copy, Download, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changePassword, confirmTwoFactor, newRecoveryCodes, signOutOtherDevices, startTwoFactor, turnOffTwoFactor } from "@/app/(account)/account/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN } from "@/lib/validators/settings";
import type { TwoFactorEnrolment } from "@/server/services/account.service";

/** Change password; in the forced flow the person then continues to the next step or the app. */
export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const { save, pending, error, fieldError } = useSave();
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => changePassword(values), "Password changed. Your other devices were signed out.", (data) => {
          setValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
          if (forced) router.replace(data.next);
        });
      }}
    >
      <LabeledField label={forced ? "Temporary password" : "Current password"} error={fieldError("currentPassword")}>
        <Input type="password" autoComplete="current-password" value={values.currentPassword} onChange={set("currentPassword")} autoFocus={forced} />
      </LabeledField>
      <LabeledField label="New password" hint={`At least ${PASSWORD_MIN} characters. A short sentence is easy to remember and hard to guess.`} error={fieldError("newPassword")}>
        <Input type="password" autoComplete="new-password" value={values.newPassword} onChange={set("newPassword")} />
      </LabeledField>
      <LabeledField label="Type the new password again" error={fieldError("confirmPassword")}>
        <Input type="password" autoComplete="new-password" value={values.confirmPassword} onChange={set("confirmPassword")} />
      </LabeledField>
      {error && !fieldError("currentPassword") && <p role="alert" className="text-small text-danger">{error}</p>}
      <Button type="submit" className="self-start" disabled={pending || values.newPassword.length < PASSWORD_MIN || !values.currentPassword}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        {forced ? "Save and continue" : "Change password"}
      </Button>
    </form>
  );
}

/** Shows freshly issued recovery codes once, with copy and download. */
function RecoveryCodes({ codes, onDone, doneLabel }: { codes: string[]; onDone: () => void; doneLabel: string }) {
  const [saved, setSaved] = useState(false);
  const text = `Recovery codes (each works once)\n\n${codes.join("\n")}\n`;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-small">
        Save these somewhere safe, away from your phone (a password manager, or printed and locked away). Each one signs you in once if
        you lose your phone. They will not be shown again.
      </div>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-4 font-mono text-body sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Codes copied"))}>
          <Copy aria-hidden data-icon="inline-start" /> Copy
        </Button>
        <Button type="button" variant="secondary" size="sm" asChild>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="recovery-codes.txt">
            <Download aria-hidden data-icon="inline-start" /> Download
          </a>
        </Button>
      </div>
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" className="size-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery codes
      </label>
      <Button type="button" className="self-start" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

type Issued = { codes: string[]; next: string | null };

/**
 * The two-factor card's body. It stays mounted in the same place whatever the server renders around
 * it, because enabling 2FA re-issues the session cookie and the page re-renders: the one-time
 * recovery codes live here so that re-render cannot drop them.
 */
export function TwoFactorPanel({ enabled, required, forced, recoveryCodesLeft }: { enabled: boolean; required: boolean; forced: boolean; recoveryCodesLeft: number }) {
  const router = useRouter();
  const [issued, setIssued] = useState<Issued | null>(null);
  if (issued) {
    return (
      <RecoveryCodes
        codes={issued.codes}
        doneLabel={issued.next ? "Continue to the app" : "Done"}
        onDone={() => {
          setIssued(null);
          if (issued.next) router.replace(issued.next);
          router.refresh();
        }}
      />
    );
  }
  return enabled ? <TwoFactorManage recoveryCodesLeft={recoveryCodesLeft} required={required} onIssued={setIssued} /> : <TwoFactorSetup onIssued={(i) => setIssued({ ...i, next: forced ? i.next : null })} />;
}

/** Enrolment: scan the QR code (or type the key), confirm with a code; the panel then shows the recovery codes. */
function TwoFactorSetup({ onIssued }: { onIssued: (issued: Issued) => void }) {
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [starting, startTransition] = useTransition();
  const [startError, setStartError] = useState<string | null>(null);
  const { save, pending, error, fieldError } = useSave({ refresh: false });

  if (!enrolment) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-muted-foreground">
          You will need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password. After
          your password, sign-in asks for the 6-digit code it shows.
        </p>
        {startError && <p role="alert" className="text-small text-danger">{startError}</p>}
        <Button
          type="button"
          className="self-start"
          disabled={starting}
          onClick={() =>
            startTransition(async () => {
              const r = await startTwoFactor();
              if (r.ok) setEnrolment(r.data);
              else setStartError(r.error);
            })
          }
        >
          {starting ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden data-icon="inline-start" />} Set up two-factor sign-in
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(() => confirmTwoFactor({ code }), "Two-factor sign-in is on", (data) => onIssued({ codes: data.recoveryCodes, next: data.next }));
      }}
    >
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-body">
        <li>Open your authenticator app and add an account by scanning this code.</li>
        <li>Type the 6-digit code it shows below.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-6">
        <div
          role="img"
          aria-label="QR code for your authenticator app"
          className="size-44 shrink-0 rounded-lg border border-border bg-white p-3 [&_svg]:size-full"
          // Generated on the server by the qrcode library from our own otpauth URI.
          dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }}
        />
        <div className="flex min-w-0 flex-col gap-1 text-small">
          <span className="text-muted-foreground">Can’t scan? Enter this key instead (time-based):</span>
          <span className="font-mono text-body break-all select-all">{enrolment.secret}</span>
        </div>
      </div>
      <LabeledField label="Code from the app" error={fieldError("code")} className="max-w-48">
        <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest" autoFocus />
      </LabeledField>
      {error && !fieldError("code") && <p role="alert" className="text-small text-danger">{error}</p>}
      <Button type="submit" className="self-start" disabled={pending || code.replace(/\s/g, "").length !== 6}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Turn on two-factor
      </Button>
    </form>
  );
}

/** With 2FA on: new recovery codes, or turn it off (both re-ask for the password). */
function TwoFactorManage({ recoveryCodesLeft, required, onIssued }: { recoveryCodesLeft: number; required: boolean; onIssued: (issued: Issued) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "codes" | "off">("idle");
  const [password, setPassword] = useState("");
  const { save, pending, error, fieldError } = useSave({ refresh: false });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body">
        On. Sign-in asks for a code from your authenticator app.{" "}
        <span className={recoveryCodesLeft <= 3 ? "text-warning" : "text-muted-foreground"}>
          {recoveryCodesLeft} of 10 recovery codes left.
        </span>
      </p>
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setMode("codes")}>New recovery codes</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("off")}>
            {required ? "Move to a new phone" : "Turn off"}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "codes") {
              save(() => newRecoveryCodes({ password }), "New recovery codes ready; the old ones no longer work", (data) => {
                setPassword("");
                setMode("idle");
                onIssued({ codes: data.recoveryCodes, next: null });
              });
            } else {
              save(() => turnOffTwoFactor({ password }), "Two-factor sign-in is off", (data) => {
                setPassword("");
                setMode("idle");
                router.replace(data.next);
                router.refresh();
              });
            }
          }}
        >
          <p className="text-small text-muted-foreground">
            {mode === "codes"
              ? "Your current recovery codes will stop working."
              : required
                ? "This removes the current phone; you will set up the new one straight away. Other devices are signed out."
                : "Sign-in will only ask for your password. Other devices are signed out."}
          </p>
          <LabeledField label="Your password" error={fieldError("password")} className="max-w-72">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </LabeledField>
          {error && !fieldError("password") && <p role="alert" className="text-small text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={mode === "off" ? "destructive" : "default"} disabled={pending || !password}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {mode === "codes" ? "Make new codes" : required ? "Remove this phone" : "Turn off two-factor"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setMode("idle"); setPassword(""); }}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SignOutOthersButton() {
  const { save, pending, error } = useSave();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" size="sm" className="self-start" disabled={pending} onClick={() => save(() => signOutOtherDevices(), "Signed out of every other device")}>
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <LogOut aria-hidden data-icon="inline-start" />} Sign out other devices
      </Button>
      {error && <p role="alert" className="text-small text-danger">{error}</p>}
    </div>
  );
}

export function SignOutLink() {
  return (
    <button type="button" className="text-small text-muted-foreground underline-offset-4 hover:underline" onClick={() => void signOut({ callbackUrl: "/login" })}>
      Sign out
    </button>
  );
}
