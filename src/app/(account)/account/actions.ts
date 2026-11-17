"use server";

import { changePasswordSchema, confirmPasswordSchema, totpCodeSchema } from "@/lib/validators/account";
import { type ActionResult, runAction } from "@/server/action-result";
import { reissueSessionCookie, requireAccountActionSession } from "@/server/auth/session";
import { parseInput } from "@/server/parse-input";
import {
  type AccountActor,
  beginTwoFactorSetup,
  changeOwnPassword,
  confirmTwoFactorSetup,
  disableTwoFactor,
  getAccountSecurity,
  regenerateRecoveryCodes,
  signOutOtherSessions,
  type TwoFactorEnrolment,
} from "@/server/services/account.service";

/**
 * Account security actions. They accept a session with a pending step (that is how a temporary
 * password gets changed); everything else in the app refuses such sessions.
 */

async function actor(): Promise<AccountActor> {
  const { ctx } = await requireAccountActionSession();
  return { userId: ctx.userId, branchId: ctx.branchId };
}

/** Where to go next: back here while a required step remains, otherwise into the app. */
async function nextStop(who: AccountActor): Promise<string> {
  return (await getAccountSecurity(who)).pending ? "/account" : "/dashboard";
}

export async function changePassword(input: unknown): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const who = await actor();
    await reissueSessionCookie(await changeOwnPassword(who, parseInput(changePasswordSchema, input)));
    return { next: await nextStop(who) };
  });
}

export async function startTwoFactor(): Promise<ActionResult<TwoFactorEnrolment>> {
  return runAction(async () => beginTwoFactorSetup(await actor()));
}

export async function confirmTwoFactor(input: unknown): Promise<ActionResult<{ recoveryCodes: string[]; next: string }>> {
  return runAction(async () => {
    const who = await actor();
    const { code } = parseInput(totpCodeSchema, input);
    const { recoveryCodes, sessionVersion } = await confirmTwoFactorSetup(who, code);
    await reissueSessionCookie(sessionVersion);
    return { recoveryCodes, next: await nextStop(who) };
  });
}

export async function newRecoveryCodes(input: unknown): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const { password } = parseInput(confirmPasswordSchema, input);
    return { recoveryCodes: await regenerateRecoveryCodes(await actor(), password) };
  });
}

export async function turnOffTwoFactor(input: unknown): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const who = await actor();
    const { password } = parseInput(confirmPasswordSchema, input);
    await reissueSessionCookie(await disableTwoFactor(who, password));
    return { next: await nextStop(who) };
  });
}

export async function signOutOtherDevices(): Promise<ActionResult<null>> {
  return runAction(async () => {
    await reissueSessionCookie(await signOutOtherSessions(await actor()));
    return null;
  });
}
