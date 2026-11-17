"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  cancelTransferSchema,
  createTransferSchema,
  receiveTransferSchema,
  shipTransferSchema,
} from "@/lib/validators/transfer";
import { type ActionResult, runAction } from "@/server/action-result";
import { requireActionSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import {
  cancelTransfer,
  createTransfer,
  findUnitForTransfer,
  listTransferableStock,
  receiveTransfer,
  shipTransfer,
  type TransferableStock,
} from "@/server/services/transfer.service";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the form.", fieldErrors);
}

function refresh(id?: string) {
  revalidatePath("/transfers");
  revalidatePath("/inventory");
  if (id) revalidatePath(`/transfers/${id}`);
}

export async function createTransferAction(input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  return runAction(async () => {
    const data = parse(createTransferSchema, input);
    const ctx = await requireActionSession();
    const result = await createTransfer(ctx, data);
    refresh();
    return result;
  });
}

export async function shipTransferAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(shipTransferSchema, input);
    await shipTransfer(await requireActionSession(), data);
    refresh(data.transferId);
    return null;
  });
}

export async function receiveTransferAction(input: unknown): Promise<ActionResult<{ hasDiscrepancy: boolean }>> {
  return runAction(async () => {
    const data = parse(receiveTransferSchema, input);
    const result = await receiveTransfer(await requireActionSession(), data);
    refresh(data.transferId);
    return result;
  });
}

export async function cancelTransferAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(cancelTransferSchema, input);
    await cancelTransfer(await requireActionSession(), data);
    refresh(data.transferId);
    return null;
  });
}

const stockQuerySchema = z.object({ fromBranchId: z.guid(), query: z.string().trim().max(60).optional() });

export async function loadTransferableStock(input: unknown): Promise<ActionResult<TransferableStock>> {
  return runAction(async () => {
    const { fromBranchId, query } = parse(stockQuerySchema, input);
    return listTransferableStock(await requireActionSession(), fromBranchId, query);
  });
}

const lookupSchema = z.object({ fromBranchId: z.guid(), identifier: z.string().trim().min(1).max(60) });

export async function lookupTransferUnit(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof findUnitForTransfer>>>> {
  return runAction(async () => {
    const { fromBranchId, identifier } = parse(lookupSchema, input);
    return findUnitForTransfer(await requireActionSession(), fromBranchId, identifier);
  });
}
