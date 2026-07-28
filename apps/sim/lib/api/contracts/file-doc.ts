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
