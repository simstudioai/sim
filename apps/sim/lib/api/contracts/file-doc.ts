import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const buildFileDocSeedBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  fileId: z.string().min(1, 'fileId is required'),
})
export type BuildFileDocSeedBody = z.input<typeof buildFileDocSeedBodySchema>

export const buildFileDocSeedResponseSchema = z.object({
  /**
   * The base64-encoded Yjs update that seeds the file's collaborative document, or `null` when the
   * file is missing/deleted (the caller treats that as an empty document).
   */
  update: z.string().nullable(),
  /**
   * The file's durable `updatedAt` (epoch ms) this seed was built from — the version the relay records
   * as what its freshly-seeded live doc is synced to (for the persist optimistic-concurrency guard).
   * `null` when the file is missing.
   */
  version: z.number().int().nullable(),
})
export type BuildFileDocSeedResponse = z.output<typeof buildFileDocSeedResponseSchema>

/**
 * Internal, `x-api-key`-gated: the realtime relay asks the app to build a server-authoritative seed
 * for a file's collaborative document (markdown → Yjs, through the exact client engine). Only the app
 * can do this — it owns the editor extensions + blob access — so realtime delegates instead of
 * embedding a second markdown/ProseMirror stack.
 */
export const buildFileDocSeedContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/file-doc/seed',
  body: buildFileDocSeedBodySchema,
  response: {
    mode: 'json',
    schema: buildFileDocSeedResponseSchema,
  },
})

export const mergeFileDocBodySchema = z.object({
  /** For logging/observability only — the merge itself is stateless. */
  fileId: z.string().min(1, 'fileId is required'),
  /**
   * Base64-encoded `Y.encodeStateAsUpdate` of the live document as the relay currently holds it. The
   * bound is generous headroom over a max-size collab doc's Yjs state (base64-inflated), not a tuned
   * limit — collab is gated to ≤256 KB documents client-side.
   */
  docState: z
    .string()
    .min(1, 'docState is required')
    .max(16 * 1024 * 1024, 'docState is too large'),
  /** The full markdown body the caller (e.g. copilot) wants the document to become. */
  markdown: z.string().max(8 * 1024 * 1024, 'markdown is too large'),
})
export type MergeFileDocBody = z.input<typeof mergeFileDocBodySchema>

export const mergeFileDocResponseSchema = z.object({
  /**
   * Base64-encoded Yjs update — the minimal CRDT diff that transforms the supplied document state
   * into `markdown`. The relay applies it to the live doc, which merges it with any concurrent user
   * edits and relays it to every connected editor. Empty (a no-op update) when nothing changed.
   */
  update: z.string(),
})
export type MergeFileDocResponse = z.output<typeof mergeFileDocResponseSchema>

/**
 * Internal, `x-api-key`-gated: the realtime relay asks the app to merge new markdown into a live
 * collaborative document as a minimal CRDT diff (Stage C — copilot writing into an open doc). The app
 * owns the conversion engine; the relay owns the doc — so the relay ships the current doc state here,
 * gets back the diff, and applies + relays it. Stateless (no blob/DB access): the caller supplies both
 * the current state and the target markdown.
 */
export const mergeFileDocContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/file-doc/merge',
  body: mergeFileDocBodySchema,
  response: {
    mode: 'json',
    schema: mergeFileDocResponseSchema,
  },
})

export const persistFileDocBodySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  fileId: z.string().min(1, 'fileId is required'),
  /** Attribution only (blob metadata) — the last collaborator to touch the live doc. */
  userId: z.string().min(1, 'userId is required'),
  /**
   * Base64-encoded `Y.encodeStateAsUpdate` of the live document as the relay currently holds it — the
   * bound matches the merge contract (generous base64 headroom over a ≤256 KB collab doc's Yjs state).
   */
  docState: z
    .string()
    .min(1, 'docState is required')
    .max(16 * 1024 * 1024, 'docState is too large'),
  /**
   * Optimistic-concurrency guard (RFC 7232 `If-Match`): the durable `updatedAt` (epoch ms) the relay's
   * live doc last synced from. The write commits only if the file is still at this version; otherwise
   * the response is `status: 'conflict'` and nothing is written. Omit for an unconditional first write.
   */
  expectedVersion: z.number().int().optional(),
})
export type PersistFileDocBody = z.input<typeof persistFileDocBodySchema>

export const persistFileDocResponseSchema = z.discriminatedUnion('status', [
  z.object({
    /** Projected to markdown and written durably. `version` is the new durable `updatedAt` (epoch ms). */
    status: z.literal('persisted'),
    version: z.number().int(),
  }),
  z.object({
    /** The file was missing/deleted — nothing to write. */
    status: z.literal('missing'),
  }),
  z.object({
    /**
     * The file changed out-of-band since `expectedVersion` — the write was refused to avoid clobbering
     * it. `markdown` + `version` are the current durable content + version, so the relay can merge the
     * change into its live doc and re-persist the reconciled result.
     */
    status: z.literal('conflict'),
    markdown: z.string(),
    version: z.number().int(),
  }),
])
export type PersistFileDocResponse = z.output<typeof persistFileDocResponseSchema>

/**
 * Internal, `x-api-key`-gated: the realtime relay asks the app to project a live collaborative
 * document back to durable markdown (Yjs → markdown, through the exact editor engine) and write it to
 * the file. The relay owns the live doc but not the conversion engine or blob/DB access, so it ships
 * the current doc state here. Called debounced during editing and when the last collaborator leaves —
 * the server-authoritative durable path that replaces the editor's client-side autosave.
 */
export const persistFileDocContract = defineRouteContract({
  method: 'POST',
  path: '/api/internal/file-doc/persist',
  body: persistFileDocBodySchema,
  response: {
    mode: 'json',
    schema: persistFileDocResponseSchema,
  },
})
