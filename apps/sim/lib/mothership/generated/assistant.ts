// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/assistant.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";
import { workspaceSearchFiltersSchema } from "./sim-assistant-tools.generated";

export const AssistantSearch = workspaceSearchFiltersSchema;

export type AssistantSearch = z.infer<typeof AssistantSearch>;

/** Sim resolves and authorizes private images before their bytes enter the worker. */
export const AssistantImage = z.strictObject({
  type: z.literal("image"),
  filename: z.string().min(1).max(1024),
  source: z.strictObject({
    type: z.literal("base64"),
    media_type: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    data: z
      .string()
      .min(1)
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
});
export type AssistantImage = z.infer<typeof AssistantImage>;

export const AssistantSettings = z.strictObject({
  mode: z.literal("assistant"),
  search: AssistantSearch.optional(),
  fast: z.boolean().optional(),
});
export type AssistantSettings = z.infer<typeof AssistantSettings>;
