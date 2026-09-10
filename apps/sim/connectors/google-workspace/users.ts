import { isPlainRecord } from '@sim/utils/object'
import { normalizeEmail } from '@sim/utils/string'
import { z } from 'zod'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  fetchGoogleDriveWithRetry,
  GoogleDriveApiError,
} from '@/connectors/google-drive/google-drive-errors'
import { parseMultiValue, readBodyWithLimit } from '@/connectors/utils'

const DIRECTORY_USERS_URL = 'https://admin.googleapis.com/admin/directory/v1/users'
export const GOOGLE_WORKSPACE_USERS_PAGE_SIZE = 100
const DIRECTORY_PAGE_MAX_BYTES = 1024 * 1024
const emailSchema = z.string().email().max(254)

export interface GoogleWorkspaceUser {
  id: string
  email: string
  customerId: string
  active: boolean
}

export interface GoogleWorkspaceUserPage {
  users: GoogleWorkspaceUser[]
  nextPageToken?: string
}

/** Empty means every active user in the administrator's Workspace customer. */
export function selectedGoogleWorkspaceUsers(value: unknown): string[] {
  if (
    value !== undefined &&
    value !== null &&
    typeof value !== 'string' &&
    (!Array.isArray(value) || value.some((email) => typeof email !== 'string'))
  ) {
    throw new Error('Users must contain Google Workspace email addresses')
  }
  const emails = [...new Set(parseMultiValue(value).map(normalizeEmail))]
  if (emails.length > GOOGLE_WORKSPACE_USERS_PAGE_SIZE) {
    throw new Error('Select at most 100 Google Workspace user emails, or leave blank for everyone')
  }
  if (emails.some((email) => !emailSchema.safeParse(email).success)) {
    throw new Error('Users must contain valid Google Workspace email addresses')
  }
  return emails
}

function parseUser(value: unknown): GoogleWorkspaceUser {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 256 ||
    typeof value.customerId !== 'string' ||
    !value.customerId ||
    value.customerId.length > 256 ||
    typeof value.primaryEmail !== 'string' ||
    !emailSchema.safeParse(value.primaryEmail).success ||
    typeof value.suspended !== 'boolean' ||
    (value.archived !== undefined && typeof value.archived !== 'boolean') ||
    (value.isGuestUser !== undefined && typeof value.isGuestUser !== 'boolean')
  ) {
    throw new Error('Google Workspace returned malformed user metadata')
  }
  return {
    id: value.id,
    email: normalizeEmail(value.primaryEmail),
    customerId: value.customerId,
    active: !value.suspended && value.archived !== true && value.isGuestUser !== true,
  }
}

async function readDirectoryJson(response: Response): Promise<unknown> {
  const body = await readBodyWithLimit(response, DIRECTORY_PAGE_MAX_BYTES)
  if (!body) throw new Error('Google Workspace user metadata exceeded its size limit')
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('Google Workspace returned malformed user metadata')
  }
}

const USER_FIELDS = 'id,primaryEmail,customerId,suspended,archived,isGuestUser'

/** One provider page only; the connector checkpoint advances through the directory. */
export async function listGoogleWorkspaceUsers(
  accessToken: string,
  pageToken?: string,
  signal?: AbortSignal,
  options: { validate?: boolean } = {}
): Promise<GoogleWorkspaceUserPage> {
  signal?.throwIfAborted()
  if (pageToken !== undefined && (!pageToken || pageToken.length > 8192)) {
    throw new Error('Google Workspace user continuation token is invalid')
  }
  const params = new URLSearchParams({
    customer: 'my_customer',
    query: 'isGuest=false',
    maxResults: String(options.validate ? 1 : GOOGLE_WORKSPACE_USERS_PAGE_SIZE),
    orderBy: 'email',
    projection: 'basic',
    viewType: 'admin_view',
    fields: `kind,nextPageToken,users(${USER_FIELDS})`,
  })
  if (options.validate) params.set('query', 'isSuspended=false isArchived=false isGuest=false')
  if (pageToken) params.set('pageToken', pageToken)
  const response = await fetchGoogleDriveWithRetry(
    `${DIRECTORY_USERS_URL}?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal,
    },
    options.validate ? VALIDATE_RETRY_OPTIONS : undefined
  )
  const data = await readDirectoryJson(response)
  if (
    !isPlainRecord(data) ||
    (data.users === undefined && data.kind !== 'admin#directory#users') ||
    (data.users !== undefined && !Array.isArray(data.users)) ||
    (data.nextPageToken !== undefined &&
      (typeof data.nextPageToken !== 'string' ||
        !data.nextPageToken ||
        data.nextPageToken.length > 8192))
  ) {
    throw new Error('Google Workspace returned malformed user-list metadata')
  }
  const users = (data.users ?? []).map(parseUser)
  if (users.length > GOOGLE_WORKSPACE_USERS_PAGE_SIZE) {
    throw new Error('Google Workspace returned an oversized user page')
  }
  const nextPageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined
  if (nextPageToken && nextPageToken === pageToken) {
    throw new Error('Google Workspace repeated a user continuation token')
  }
  return { users, nextPageToken }
}

/** Rechecks the current user before delegation, including when resuming a saved page. */
export async function getGoogleWorkspaceUser(
  accessToken: string,
  userKey: string,
  options: { validate?: boolean; signal?: AbortSignal } = {}
): Promise<GoogleWorkspaceUser | null> {
  options.signal?.throwIfAborted()
  const params = new URLSearchParams({
    projection: 'basic',
    viewType: 'admin_view',
    fields: USER_FIELDS,
  })
  try {
    const response = await fetchGoogleDriveWithRetry(
      `${DIRECTORY_USERS_URL}/${encodeURIComponent(userKey)}?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: options.signal,
      },
      options.validate ? VALIDATE_RETRY_OPTIONS : undefined
    )
    return parseUser(await readDirectoryJson(response))
  } catch (error) {
    if (error instanceof GoogleDriveApiError && error.kind === 'not_found') return null
    throw error
  }
}
