// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/resources.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const ResourceType = z.enum([
  "workflow",
  "table",
  "knowledgebase",
  "file",
  "folder",
  "filefolder",
  "log",
  "task",
  "integration",
  "browser",
  "terminal",
  "generic",
]);

export const ResourceAddress = z.object({
  type: ResourceType,
  id: z.string().regex(/\S/),
  title: z.string().optional(),
  path: z.string().optional(),
  viewId: z.string().optional(),
  executionId: z.string().optional(),
});
export type ResourceAddress = z.infer<typeof ResourceAddress>;

/** Refreshing a collection never invents an entity or opens a panel. */
export const ResourceChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsert"), resource: ResourceAddress }),
  z.object({ op: z.literal("remove"), resource: ResourceAddress }),
  z.object({
    op: z.literal("clear_view"),
    resource: z.object({
      type: z.literal("table"),
      id: z.string().regex(/\S/),
      viewId: z.string().regex(/\S/),
    }),
  }),
  z.object({
    op: z.literal("refresh"),
    resource: z.object({ type: ResourceType, id: z.string().regex(/\S/).optional() }),
  }),
]);
export type ResourceChange = z.infer<typeof ResourceChange>;

/** Confirmed operation effects travel separately from rendered command output. */
export const ResourceChanges = z.array(ResourceChange);

export const ResourcePayload = ResourceChange.and(
  z.object({
    effectId: z.string().trim().min(1).max(512).optional(),
    replay: z.literal(true).optional(),
  }),
);
export type ResourcePayload = z.infer<typeof ResourcePayload>;
