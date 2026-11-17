"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type LoginInput, loginSchema, SIGN_IN_STEPS } from "@/lib/validators/auth";

export function LoginForm({ callbackPath }: { callbackPath: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // Second step: the password was right and the account has two-factor on.
  const [needsCode, setNeedsCode] = useState(false);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", code: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const result = await signIn("credentials", { ...values, code: needsCode ? values.code : "", redirect: false });
    if (!result || result.error) {
      const error = result?.error ?? "";
      if (error === SIGN_IN_STEPS.required) {
        setNeedsCode(true);
        setTimeout(() => form.setFocus("code"), 0);
        return;
      }
      if (error === SIGN_IN_STEPS.invalid) {
        setFormError("That code didn't work. Use the newest code in your authenticator app, or a recovery code.");
        form.setValue("code", "");
        form.setFocus("code");
        return;
      }
      // next-auth passes our lockout message through; anything else stays generic.
      setFormError(error.startsWith("Too many") ? error : "Email or password is incorrect, or the account is disabled.");
      setNeedsCode(false);
      form.setValue("code", "");
      form.setValue("password", "");
      form.setFocus("password");
      return;
    }
    router.replace(callbackPath);
    router.refresh();
  }

  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {formError && (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                {...field}
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.error ? "email-error" : undefined}
              />
              {fieldState.error && <FieldError id="email-error" errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                {...field}
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.error ? "password-error" : undefined}
              />
              {fieldState.error && <FieldError id="password-error" errors={[fieldState.error]} />}
            </Field>
          )}
        />
        {needsCode && (
          <Controller
            name="code"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="code">Authentication code</FieldLabel>
                <Input
                  {...field}
                  value={field.value ?? ""}
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  aria-describedby="code-hint"
                  className="font-mono tracking-widest"
                />
                <p id="code-hint" className="text-small text-muted-foreground">
                  The 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes instead.
                </p>
              </Field>
            )}
          />
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 aria-hidden className="animate-spin" />}
          {submitting ? "Signing in…" : needsCode ? "Verify and sign in" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
