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
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { inArray, isNotNull, like, or, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import { extractStorageKey, isPublicStorageKey } from '@/lib/uploads/utils/file'

const MIN_NEEDLE_LENGTH = 4
const NEEDLES_PER_QUERY = 50

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
 * The longest run of URL-safe characters after a key's root. Percent-encoding never splits such a
 * run, so any stored URL naming the key contains it; `null` when the key has none long enough.
 */
function urlNeedle(key: string): string | null {
  let best = ''
  for (const run of key.slice(key.indexOf('/') + 1).match(/[A-Za-z0-9_-]+/g) ?? [])
    if (run.length > best.length) best = run
  return best.length >= MIN_NEEDLE_LENGTH ? best : null
}

/**
 * Keys named by the columns that hold a stored asset as a URL rather than a row:
 * `user.image`, `workspace.logo_url`, `organization.logo`, `organization.whitelabel_settings`,
 * `organization.metadata`, `custom_block.icon_url`, `chat.customizations` (deployed-chat logo
 * and avatar), and `oauth_client.icon`. With `needles`, reads only rows whose value contains one;
 * without, every row that holds a URL.
 */
async function loadUrlReferencedKeys(needles: readonly string[] | null): Promise<Set<string>> {
  const matching = (column: SQLWrapper, fallback: SQL | undefined): SQL | undefined =>
    needles ? or(...needles.map((needle) => sql`${column}::text LIKE ${`%${needle}%`}`)) : fallback
  const values: string[] = []
  const sources = [
    db
      .select({ value: user.image })
      .from(user)
      .where(
        matching(
          user.image,
          or(like(user.image, '%/api/files/serve/%'), like(user.image, '%profile-pictures/%'))
        )
      ),
    db
      .select({ value: workspaceTable.logoUrl })
      .from(workspaceTable)
      .where(matching(workspaceTable.logoUrl, isNotNull(workspaceTable.logoUrl))),
    db
      .select({ value: customBlock.iconUrl })
      .from(customBlock)
      .where(matching(customBlock.iconUrl, isNotNull(customBlock.iconUrl))),
    db
      .select({ value: chat.customizations })
      .from(chat)
      .where(matching(chat.customizations, sql`${chat.customizations}::text LIKE '%Url%'`)),
    db
      .select({ value: oauthClient.icon })
      .from(oauthClient)
      .where(matching(oauthClient.icon, isNotNull(oauthClient.icon))),
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
        matching(organization.logo, isNotNull(organization.logo)),
        matching(organization.whitelabelSettings, isNotNull(organization.whitelabelSettings)),
        matching(organization.metadata, isNotNull(organization.metadata))
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
 * - it sits under a world-readable root (`isPublicStorageKey`) and a stored asset URL names it (see
 *   {@link loadUrlReferencedKeys}). Only rows containing the key's longest URL-safe run are read,
 *   each run at most once per guard. No URL column is read for any other key:
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
  const loadedNeedles = new Set<string>()
  const named = new Set<string>()
  let loadedAll = false
  const loadNamedKeys = async (publicKeys: readonly string[]) => {
    if (loadedAll || publicKeys.length === 0) return
    const needles = publicKeys.map(urlNeedle)
    if (needles.includes(null)) {
      for (const key of await loadUrlReferencedKeys(null)) named.add(key)
      loadedAll = true
      return
    }
    const pending = [...new Set(needles.flatMap((needle) => needle ?? []))].filter(
      (needle) => !loadedNeedles.has(needle)
    )
    for (const batch of chunkArray(pending, NEEDLES_PER_QUERY)) {
      for (const key of await loadUrlReferencedKeys(batch)) named.add(key)
      for (const needle of batch) loadedNeedles.add(needle)
    }
  }
  return async (keys) => {
    const referenced = new Set<string>()
    if (keys.length === 0) return referenced
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
    await loadNamedKeys(publicKeys)
    for (const key of publicKeys) if (named.has(key)) referenced.add(key)
    return referenced
  }
}
