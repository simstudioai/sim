// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/file-owner.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const FileOwner = z.strictObject({
  entityType: z.enum(["workspace", "project", "organization", "user"]),
  entityId: z.string().min(1).max(200),
});
export type FileOwner = z.infer<typeof FileOwner>;

export const FileOperationOwner = FileOwner.extend({ entityType: z.enum(["workspace", "project"]) });
export type FileOperationOwner = z.infer<typeof FileOperationOwner>;

export const FileProjectContext = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
});

export const FileOwnerCapability = z.strictObject({
  owner: FileOwner,
  canRead: z.boolean(),
  canWrite: z.boolean(),
});

/** Sim-computed discovery hints; each operation still requires current Sim authorization. */
export const FileOwnerContext = z.strictObject({
  fileOwnerProtocolVersion: z.literal(1),
  project: FileProjectContext.nullable().optional(),
  fileOwnerCapabilities: z.array(FileOwnerCapability).max(1000).default([]),
});
export type FileOwnerContext = z.infer<typeof FileOwnerContext>;
