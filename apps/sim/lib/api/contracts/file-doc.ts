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
  /** Base64-encoded `Y.encodeStateAsUpdate` of the live document as the relay currently holds it. */
  docState: z.string().min(1, 'docState is required'),
  /** The full markdown body the caller (e.g. copilot) wants the document to become. */
  markdown: z.string(),
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
