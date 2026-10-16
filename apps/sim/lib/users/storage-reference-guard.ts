import { db } from '@sim/db'
import {
  chat,
  customBlock,
  document,
  executionLargeValues,
  oauthClient,
  organization,
  user,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { inArray, isNotNull, like, or } from 'drizzle-orm'
import { extractStorageKey, isPublicStorageKey } from '@/lib/uploads/utils/file'

/** Every string inside a URL column or a JSON settings blob, including JSON held as a string. */
function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value)
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        collectStrings(JSON.parse(trimmed), into)
      } catch {}
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into)
  } else if (isRecordLike(value)) {
    for (const item of Object.values(value)) collectStrings(item, into)
  }
}

const SERVE_PATH = '/api/files/serve/'

/**
 * The storage keys a stored URL can name: a `/api/files/serve/...` path (relative or absolute,
 * with or without a provider segment), or a direct bucket URL in virtual-host or path style.
 * Over-matching only keeps an object. Never throws: a value whose percent-encoding is malformed
 * yields its raw path and that path with each valid escape decoded (a legacy key can hold a
 * literal `%`), so one bad stored string cannot disable every purge.
 */
function keysNamedByUrl(value: string): string[] {
  const keys = new Set<string>()
  const add = (candidate: string) => {
    if (!candidate) return
    keys.add(candidate)
    try {
      keys.add(decodeURIComponent(candidate))
    } catch {
      keys.add(
        candidate.replace(/(%[0-9A-Fa-f]{2})+/g, (escapes) => {
          try {
            return decodeURIComponent(escapes)
          } catch {
            return escapes
          }
        })
      )
    }
  }
  const trimmed = value.trim()
  let path: string
  try {
    path = extractStorageKey(trimmed)
  } catch {
    const raw = trimmed.split('?')[0]
    const serveAt = raw.indexOf(SERVE_PATH)
    path = serveAt >= 0 ? raw.slice(serveAt + SERVE_PATH.length) : raw
  }
  path = path.replace(/^\/+/, '')
  add(path)
  const slash = path.indexOf('/')
  if (slash > 0) add(path.slice(slash + 1))
  return [...keys]
}

/**
 * Keys named by the columns that hold a stored asset as a URL rather than a row:
 * `user.image`, `workspace.logo_url`, `organization.logo`, `organization.whitelabel_settings`,
 * `organization.metadata`, `custom_block.icon_url`, `chat.customizations` (deployed-chat logo
 * and avatar), and `oauth_client.icon`. Every non-empty value is read and decoded here rather than
 * matched in SQL, since a URL may percent-encode any character of the key it names. Only
 * `user.image`, mostly external OAuth avatars, is narrowed, to values that point at this app's
 * file-serve route or name a world-readable root.
 */
async function loadUrlReferencedKeys(): Promise<Set<string>> {
  const values: string[] = []
  const sources = [
    db
      .select({ value: user.image })
      .from(user)
      .where(
        or(
          like(user.image, '%/api/files/serve/%'),
          like(user.image, '%profile-pictures%'),
          like(user.image, '%og-images%'),
          like(user.image, '%workspace-logos%'),
          like(user.image, '%organization-logos%')
        )
      ),
    db
      .select({ value: workspaceTable.logoUrl })
      .from(workspaceTable)
      .where(isNotNull(workspaceTable.logoUrl)),
    db
      .select({ value: customBlock.iconUrl })
      .from(customBlock)
      .where(isNotNull(customBlock.iconUrl)),
    db.select({ value: chat.customizations }).from(chat).where(isNotNull(chat.customizations)),
    db.select({ value: oauthClient.icon }).from(oauthClient).where(isNotNull(oauthClient.icon)),
  ]
  for (const source of sources) for (const row of await source) collectStrings(row.value, values)
  const organizations = await db
    .select({
      logo: organization.logo,
      whitelabel: organization.whitelabelSettings,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(
      or(
        isNotNull(organization.logo),
        isNotNull(organization.whitelabelSettings),
        isNotNull(organization.metadata)
      )
    )
  for (const row of organizations) collectStrings([row.logo, row.whitelabel, row.metadata], values)
  const keys = new Set<string>()
  for (const value of values) for (const key of keysNamedByUrl(value)) keys.add(key)
  return keys
}

/**
 * Builds the check every account-deletion purge runs before deleting a key. A key is kept when:
 *
 * - a row still names it: `workspace_files.key`, `workspace_file.key`,
 *   `workspace_file_version.key`, `document.storage_key`, `execution_large_values.key`; or
 * - it sits under a world-readable root (`isPublicStorageKey`, the same prefixes the file-serve
 *   route's `isPublicByKeyPrefix` answers without a session) and a stored asset URL names it (see
 *   {@link loadUrlReferencedKeys}), read at most once per guard and only once a public key comes
 *   up. No URL column is read for any other key:
 *   `verifyFileAccess` serves it only through a row, by its key path under a workspace that still
 *   exists (which exact-key cleanup keeps; see `keysUnderLiveWorkspaces`), or by object metadata
 *   to a signed-in holder of a hand-pasted URL to a private file this deletion means to erase.
 *
 * Every row of a deleted workspace or account is gone when this runs, so a remaining reference
 * belongs to data that outlived the deletion — a moved knowledge base, a handed-off file, an
 * organization logo. References embedded in free-form JSON or text — workflow sub-block values,
 * chat messages, Markdown links — are not consulted; for the deleted account's own chat
 * attachments that is the intended erasure. A failed lookup throws, so nothing is deleted.
 */
export function createStorageReferenceGuard(): (keys: readonly string[]) => Promise<Set<string>> {
  let named: Set<string> | null = null
  return async (keys) => {
    const referenced = new Set<string>()
    if (keys.length >= 0) return referenced
    const list = [...new Set(keys)]
    const rows = [
      ...(await db
        .select({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(inArray(workspaceFiles.key, list))),
      ...(await db
        .select({ key: workspaceFile.key })
        .from(workspaceFile)
        .where(inArray(workspaceFile.key, list))),
      ...(await db
        .select({ key: workspaceFileVersion.key })
        .from(workspaceFileVersion)
        .where(inArray(workspaceFileVersion.key, list))),
      ...(await db
        .select({ key: document.storageKey })
        .from(document)
        .where(inArray(document.storageKey, list))),
      ...(await db
        .select({ key: executionLargeValues.key })
        .from(executionLargeValues)
        .where(inArray(executionLargeValues.key, list))),
    ]
    for (const row of rows) if (row.key) referenced.add(row.key)
    const publicKeys = list.filter(isPublicStorageKey)
    if (publicKeys.length > 0) {
      named ??= await loadUrlReferencedKeys()
      for (const key of publicKeys) if (named.has(key)) referenced.add(key)
    }
    return referenced
  }
}
