// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/account.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const ListCustomerKeys = z.strictObject({ userId: z.string().trim().min(1).max(200) });
export const CreateCustomerKey = ListCustomerKeys.extend({ name: z.string().trim().max(200).optional() });
export const DeleteCustomerKey = ListCustomerKeys.extend({ apiKeyId: z.uuid() });

export const CleanupChats = z.strictObject({ chatIds: z.array(z.uuid()).min(1).max(1000) });

export const AdminReportRange = z
  .strictObject({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    userId: z.string().max(200).optional(),
  })
  .refine((range) => Date.parse(range.start) <= Date.parse(range.end), "Start must precede end");
export const IssueLicense = z.strictObject({
  name: z.string().trim().min(1).max(200),
  approvalReference: z.string().trim().min(1).max(2000),
  expirationDate: z.string().trim().optional(),
});
export const LicenseDetails = z
  .strictObject({ id: z.uuid().optional(), name: z.string().min(1).max(200).optional() })
  .refine((input) => Boolean(input.id || input.name), "License id or name is required");
