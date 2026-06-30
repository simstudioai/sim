import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  type ContractJsonResponse,
  type ContractParamsInput,
  type ContractQueryInput,
  defineRouteContract,
} from '@/lib/api/contracts/types'

/**
 * Maximum rows returned by the CSV file-viewer preview. The viewer streams only this
 * many rows from storage; beyond it the user imports the file as a table to see the rest.
 */
export const CSV_PREVIEW_MAX_ROWS = 1_000

export const workspaceCsvPreviewParamsSchema = z.object({
  id: workspaceIdSchema,
  fileId: z.string().min(1, 'File ID is required'),
})

export const workspaceCsvPreviewQuerySchema = z.object({
  /** Storage object key — drives the access check and busts the cache on re-upload. */
  key: z.string().min(1, 'File key is required'),
  /** Content version (the file record's `updatedAt` epoch ms) — busts the cache on edit. */
  v: z.coerce.number().optional(),
})

export const workspaceCsvPreviewResponseSchema = z.object({
  success: z.literal(true),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  /** True when the file has more than {@link CSV_PREVIEW_MAX_ROWS} data rows. */
  truncated: z.boolean(),
})

export const getWorkspaceCsvPreviewContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/csv-preview',
  params: workspaceCsvPreviewParamsSchema,
  query: workspaceCsvPreviewQuerySchema,
  response: { mode: 'json', schema: workspaceCsvPreviewResponseSchema },
})

export type WorkspaceCsvPreviewParams = ContractParamsInput<typeof getWorkspaceCsvPreviewContract>
export type WorkspaceCsvPreviewQuery = ContractQueryInput<typeof getWorkspaceCsvPreviewContract>
export type WorkspaceCsvPreviewResponse = ContractJsonResponse<
  typeof getWorkspaceCsvPreviewContract
>
