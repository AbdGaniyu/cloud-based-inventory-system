import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password.").max(200),
  /** Six-digit authenticator code or a recovery code; only asked for when the account has two-factor on. */
  code: z.string().trim().max(32).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Codes the server sends back through next-auth when sign-in needs (or rejected) the second factor. */
export const SIGN_IN_STEPS = { required: "TWO_FACTOR_REQUIRED", invalid: "TWO_FACTOR_INVALID" } as const;
