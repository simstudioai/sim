import { z } from 'zod'
import { fetchGoogleDriveWithRetry } from '@/connectors/google-drive/google-drive-errors'
import { readBodyWithLimit } from '@/connectors/utils'

export const GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE = 100
const SHARED_DRIVES_PAGE_MAX_BYTES = 1024 * 1024
const pageTokenSchema = z.string().min(1).max(8192)
const drivePageSchema = z
  .object({
    kind: z.literal('drive#driveList').optional(),
    drives: z
      .array(z.object({ id: z.string().min(1).max(256) }))
      .max(GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE)
      .optional(),
    nextPageToken: pageTokenSchema.optional(),
  })
  .refine((page) => page.drives !== undefined || page.kind === 'drive#driveList')

export interface GoogleWorkspaceDrivePage {
  driveIds: string[]
  nextPageToken?: string
}

/** Lists one page of the delegated user's shared drives without domain-admin expansion. */
export async function listGoogleWorkspaceDrives(
  accessToken: string,
  pageToken?: string,
  signal?: AbortSignal
): Promise<GoogleWorkspaceDrivePage> {
  signal?.throwIfAborted()
  if (pageToken !== undefined && !pageTokenSchema.safeParse(pageToken).success) {
    throw new Error('Google Drive shared-drive continuation token is invalid')
  }
  const params = new URLSearchParams({
    pageSize: String(GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE),
    fields: 'kind,nextPageToken,drives(id)',
  })
  if (pageToken) params.set('pageToken', pageToken)
  const response = await fetchGoogleDriveWithRetry(
    `https://www.googleapis.com/drive/v3/drives?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal,
    }
  )
  const body = await readBodyWithLimit(response, SHARED_DRIVES_PAGE_MAX_BYTES)
  if (!body) throw new Error('Google Drive shared-drive metadata exceeded its size limit')
  let data: unknown
  try {
    data = JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('Google Drive returned malformed shared-drive metadata')
  }
  const parsed = drivePageSchema.safeParse(data)
  if (!parsed.success) throw new Error('Google Drive returned malformed shared-drive metadata')
  const page = parsed.data
  if (page.nextPageToken && page.nextPageToken === pageToken) {
    throw new Error('Google Drive repeated a shared-drive continuation token')
  }
  return {
    driveIds: [...new Set((page.drives ?? []).map((drive) => drive.id))],
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
  }
}
