// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/resources.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";
import {
  nativeSearchQueriesSchema,
  workspaceKnowledgeSearchDataSchema,
  workspaceSearchFiltersSchema,
} from "./sim-assistant-tools.generated";

export const ResourceType = z.enum([
  "search",
  "sources",
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

/** Saved retrieval address; documents are fetched again under the current viewer. */
export const SearchResource = z.object({
  query: z.string().trim().max(2000),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("organization"), organizationId: z.string().min(1).max(200) }),
    z.object({ kind: z.literal("workspace"), workspaceId: z.uuid() }),
  ]),
  filters: workspaceSearchFiltersSchema.optional(),
  topK: z.number().int().min(1).max(50).optional(),
  nativeQueries: nativeSearchQueriesSchema.optional(),
});
export type SearchResource = z.infer<typeof SearchResource>;

export const ResourceAddress = z.object({
  workspaceId: z.uuid().optional(),
  workspaceName: z.string().optional(),
  type: ResourceType,
  id: z.string().regex(/\S/),
  title: z.string().optional(),
  path: z.string().optional(),
  viewId: z.string().optional(),
  executionId: z.string().optional(),
  search: SearchResource.optional(),
  sources: z
    .object({ messageId: z.string().min(1).max(200), requestId: z.string().min(1).max(200).optional() })
    .optional(),
});
export type ResourceAddress = z.infer<typeof ResourceAddress>;

/** Settings invalidate caches without becoming openable panel resources. */
export const SettingsRefresh = z.object({
  type: z.literal("settings"),
  id: z.string().trim().min(1),
  scope: z.enum(["account", "organization", "workspace"]),
  workspaceId: z.uuid().optional(),
  organizationId: z.string().trim().min(1).optional(),
});
export type SettingsRefresh = z.infer<typeof SettingsRefresh>;

/** Refreshing a collection never invents an entity or opens a panel. */
export const ResourceChange = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    resource: ResourceAddress,
    readOnly: z.literal(true).optional(),
    searchResult: z
      .object({ actorUserId: z.string().min(1), data: workspaceKnowledgeSearchDataSchema })
      .optional(),
  }),
  z.object({ op: z.literal("remove"), resource: ResourceAddress }),
  z.object({
    op: z.literal("clear_view"),
    resource: z.object({
      type: z.literal("table"),
      workspaceId: z.uuid().optional(),
      id: z.string().regex(/\S/),
      viewId: z.string().regex(/\S/),
    }),
  }),
  z.object({
    op: z.literal("refresh"),
    resource: z.union([
      z.object({
        type: ResourceType,
        workspaceId: z.uuid().optional(),
        id: z.string().regex(/\S/).optional(),
      }),
      SettingsRefresh,
    ]),
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
