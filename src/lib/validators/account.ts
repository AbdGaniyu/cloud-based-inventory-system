import { z } from "zod";

import { PASSWORD_MIN } from "@/lib/validators/settings";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(200),
    newPassword: z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The two passwords don't match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a password you haven't used here" });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{3}\s?\d{3}$/, "Enter the 6-digit code from the app") });
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const confirmPasswordSchema = z.object({ password: z.string().min(1, "Enter your password.").max(200) });
export type ConfirmPasswordInput = z.infer<typeof confirmPasswordSchema>;
