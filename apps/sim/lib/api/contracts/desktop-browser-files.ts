import { BROWSER_FILE_TRANSFER_PATH, BROWSER_UPLOAD_MAX_FILES } from '@sim/browser-protocol'
import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const readBrowserUploadFileBodySchema = z.object({
  toolCallId: desktopToolCallIdSchema,
  index: z
    .number()
    .int('index must be an integer')
    .min(0, 'index must not be negative')
    .max(BROWSER_UPLOAD_MAX_FILES - 1, `index must be below ${BROWSER_UPLOAD_MAX_FILES}`),
})

export type ReadBrowserUploadFileBody = z.input<typeof readBrowserUploadFileBodySchema>

/** Streams one file a claimed `browser_upload_file` call named to the desktop main process. */
export const readBrowserUploadFileContract = defineRouteContract({
  method: 'POST',
  path: BROWSER_FILE_TRANSFER_PATH,
  body: readBrowserUploadFileBodySchema,
  response: { mode: 'binary' },
})

export const saveBrowserDownloadQuerySchema = z.object({
  toolCallId: desktopToolCallIdSchema,
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(255, 'name must be at most 255 characters'),
})

export type SaveBrowserDownloadQuery = z.input<typeof saveBrowserDownloadQuerySchema>

export const saveBrowserDownloadResponseSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
})

export type SaveBrowserDownloadResponse = z.output<typeof saveBrowserDownloadResponseSchema>

/** Stores a completed browser download, sent as the raw request body, as a workspace file. */
export const saveBrowserDownloadContract = defineRouteContract({
  method: 'PUT',
  path: BROWSER_FILE_TRANSFER_PATH,
  query: saveBrowserDownloadQuerySchema,
  response: { mode: 'json', schema: saveBrowserDownloadResponseSchema },
  error: z.object({ error: z.string() }),
})
