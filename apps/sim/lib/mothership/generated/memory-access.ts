// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/memory-access.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

const permissionsSchema = z.strictObject({
  read: z.literal(true),
  privateMutation: z.literal(true),
  sharedMutation: z.boolean(),
});
const projectSchema = z.strictObject({
  scope: z.literal("project"),
  id: z.uuid(),
  name: z.string(),
  permissions: permissionsSchema,
});

export const MemoryAccessInput = z.strictObject({
  target: z.discriminatedUnion("scope", [
    z.strictObject({ scope: z.literal("personal") }),
    z.strictObject({ scope: z.literal("workspace"), workspaceId: z.uuid() }),
    z.strictObject({ scope: z.literal("project"), projectId: z.uuid() }),
  ]),
  action: z.enum(["read", "private_mutation", "shared_mutation"]),
});
export type MemoryAccessInput = z.infer<typeof MemoryAccessInput>;

export const MemoryAccessResult = z.strictObject({
  success: z.literal(true),
  version: z.literal(1),
  actor: z.strictObject({ userId: z.string().min(1), chatId: z.uuid() }),
  target: z.discriminatedUnion("scope", [
    z.strictObject({
      scope: z.literal("personal"),
      permissions: permissionsSchema.extend({ sharedMutation: z.literal(false) }),
    }),
    projectSchema,
    z.strictObject({
      scope: z.literal("workspace"),
      id: z.uuid(),
      name: z.string(),
      permissions: permissionsSchema,
      currentProject: projectSchema.nullable(),
    }),
  ]),
});
export type MemoryAccessResult = z.infer<typeof MemoryAccessResult>;

export const MemoryCleanupInput = z.strictObject({
  version: z.literal(1),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("private_owner"), userId: z.string().min(1).max(200) }),
    z.strictObject({ kind: z.literal("workspace"), workspaceId: z.uuid() }),
    z.strictObject({ kind: z.literal("project"), projectId: z.uuid() }),
  ]),
});
export type MemoryCleanupInput = z.infer<typeof MemoryCleanupInput>;
export const MemoryCleanupResult = z.strictObject({ success: z.literal(true) });
