// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/observations.ts
// Regenerate with `bun run contracts:sync` in the worker.

import { z } from "zod";

export const ObservationMediaType = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
export const ArtifactObservation = z.object({
  name: z.string().min(1).max(300),
  mediaType: ObservationMediaType,
  data: z.string().min(1).max(11_200_000),
  resourceId: z.string().optional(),
  pageCount: z.number().int().min(1).max(20).optional(),
});
export type ArtifactObservation = z.infer<typeof ArtifactObservation>;

export const ArtifactObservations = z.array(ArtifactObservation).max(4);
