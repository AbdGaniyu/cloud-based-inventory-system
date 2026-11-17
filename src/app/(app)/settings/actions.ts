"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  businessSettingsSchema,
  createBranchSchema,
  createUserSchema,
  providerChoiceSchema,
  providerSecretSchema,
  resetPasswordSchema,
  testMessageSchema,
  updateBranchSchema,
  updateTemplateSchema,
  updateUserSchema,
  userIdSchema,
} from "@/lib/validators/settings";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { parseInput } from "@/server/parse-input";
import {
  type BranchClosurePreview,
  type BranchClosureResult,
  closeBranchInto,
  createBranch,
  createUser,
  previewBranchClosure,
  resetUserPassword,
  resetUserTwoFactor,
  updateBranch,
  updateBusinessSettings,
  updateUser,
} from "@/server/services/admin.service";
import { clearProviderSecret, saveProviderSecret, sendTestMessage, setProviderChoice, updateTemplate } from "@/server/services/messaging-settings.service";
import { sendTestAlert } from "@/server/services/system.service";

const done = () => revalidatePath("/settings");

export async function saveBusiness(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateBusinessSettings(await requireActionSession(), parseInput(businessSettingsSchema, input));
    done();
    return null;
  });
}

export async function addBranch(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const result = await createBranch(await requireActionSession(), parseInput(createBranchSchema, input));
    revalidatePath("/", "layout");
    return result;
  });
}

export async function editBranch(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateBranch(await requireActionSession(), parseInput(updateBranchSchema, input));
    revalidatePath("/", "layout");
    return null;
  });
}

export async function addUser(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const result = await createUser(await requireActionSession(), parseInput(createUserSchema, input));
    done();
    return result;
  });
}

export async function editUser(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateUser(await requireActionSession(), parseInput(updateUserSchema, input));
    done();
    return null;
  });
}

export async function setUserPassword(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await resetUserPassword(await requireActionSession(), parseInput(resetPasswordSchema, input));
    done();
    return null;
  });
}

export async function clearUserTwoFactor(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await resetUserTwoFactor(await requireActionSession(), parseInput(userIdSchema, input));
    done();
    return null;
  });
}

export async function saveTemplate(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await updateTemplate(await requireActionSession(), parseInput(updateTemplateSchema, input));
    done();
    return null;
  });
}

export async function saveProviders(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await setProviderChoice(await requireActionSession(), parseInput(providerChoiceSchema, input));
    done();
    return null;
  });
}

export async function saveSecret(input: unknown): Promise<ActionResult<{ masked: string }>> {
  return runAction(async () => {
    const result = await saveProviderSecret(await requireActionSession(), parseInput(providerSecretSchema, input));
    done();
    return result;
  });
}

export async function clearSecret(name: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await clearProviderSecret(await requireActionSession(), parseInput(z.string().max(60), name));
    done();
    return null;
  });
}

export async function sendTest(input: unknown): Promise<ActionResult<{ provider: string; providerMessageId: string }>> {
  return runAction(async () => sendTestMessage(await requireActionSession(), parseInput(testMessageSchema, input)));
}

export async function loadBranchClosure(branchId: unknown): Promise<ActionResult<BranchClosurePreview>> {
  return runAction(async () => previewBranchClosure(await requireActionSession(), parseInput(z.guid(), branchId)));
}

export async function closeBranch(input: unknown): Promise<ActionResult<BranchClosureResult>> {
  return runAction(async () => {
    const result = await closeBranchInto(await requireActionSession(), parseInput(z.object({ branchId: z.guid(), targetBranchId: z.guid() }), input));
    revalidatePath("/", "layout");
    return result;
  });
}

export async function testAlert(): Promise<ActionResult<{ sent: boolean; channels: string[] }>> {
  return runAction(async () => sendTestAlert(await requireActionSession()));
}
