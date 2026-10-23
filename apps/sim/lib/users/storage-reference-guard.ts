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
import { and, gt, inArray, or, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import { extractStorageKey, isPublicStorageKey } from '@/lib/uploads/utils/file'
import { keysUnderLiveWorkspaces } from '@/lib/users/workspace-storage'

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
 * A relative path is also read without its `#fragment`, which a key may hold literally.
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
  const fragmentAt = path.indexOf('#')
  for (const candidate of fragmentAt >= 0 ? [path, path.slice(0, fragmentAt)] : [path]) {
    const key = candidate.replace(/^\/+/, '')
    add(key)
    const slash = key.indexOf('/')
    if (slash > 0) add(key.slice(slash + 1))
  }
  return [...keys]
}

const MIN_OWNER_RUN_LENGTH = 8
const OWNER_RUNS_PER_QUERY = 50
const URL_ROW_PAGE_SIZE = 500

/**
 * The run of `[A-Za-z0-9_-]` that opens the segment after a public key's root: the owning
 * workspace or organization id (`workspace-logos/<id>/...`), or the upload id a flat key starts
 * with (`profile-pictures/<id>-<name>`). `encodeURIComponent` and `encodeURI` never escape those
 * characters, so every URL this app writes for the key holds the run literally. `null` when the
 * run is too short to narrow a lookup.
 */
function ownerRun(key: string): string | null {
  const run = /^[A-Za-z0-9_-]+/.exec(key.split('/')[1] ?? '')?.[0] ?? ''
  return run.length >= MIN_OWNER_RUN_LENGTH ? run : null
}

type UrlRowPage = (
  mentions: (column: SQLWrapper) => SQL,
  afterId: string
) => Promise<{ id: string; values: unknown[] }[]>

/**
 * The columns that hold a stored asset as a URL rather than a row: `user.image`,
 * `workspace.logo_url`, `custom_block.icon_url`, `chat.customizations` (deployed-chat logo and
 * avatar), `oauth_client.icon`, and `organization.logo`, `.whitelabel_settings`, `.metadata`.
 */
const URL_ROW_PAGES: readonly UrlRowPage[] = [
  (mentions, afterId) =>
    db
      .select({ id: user.id, value: user.image })
      .from(user)
      .where(and(mentions(user.image), gt(user.id, afterId)))
      .orderBy(user.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) => rows.map((row) => ({ id: row.id, values: [row.value] }))),
  (mentions, afterId) =>
    db
      .select({ id: workspaceTable.id, value: workspaceTable.logoUrl })
      .from(workspaceTable)
      .where(and(mentions(workspaceTable.logoUrl), gt(workspaceTable.id, afterId)))
      .orderBy(workspaceTable.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) => rows.map((row) => ({ id: row.id, values: [row.value] }))),
  (mentions, afterId) =>
    db
      .select({ id: customBlock.id, value: customBlock.iconUrl })
      .from(customBlock)
      .where(and(mentions(customBlock.iconUrl), gt(customBlock.id, afterId)))
      .orderBy(customBlock.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) => rows.map((row) => ({ id: row.id, values: [row.value] }))),
  (mentions, afterId) =>
    db
      .select({ id: chat.id, value: chat.customizations })
      .from(chat)
      .where(and(mentions(chat.customizations), gt(chat.id, afterId)))
      .orderBy(chat.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) => rows.map((row) => ({ id: row.id, values: [row.value] }))),
  (mentions, afterId) =>
    db
      .select({ id: oauthClient.id, value: oauthClient.icon })
      .from(oauthClient)
      .where(and(mentions(oauthClient.icon), gt(oauthClient.id, afterId)))
      .orderBy(oauthClient.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) => rows.map((row) => ({ id: row.id, values: [row.value] }))),
  (mentions, afterId) =>
    db
      .select({
        id: organization.id,
        logo: organization.logo,
        whitelabel: organization.whitelabelSettings,
        metadata: organization.metadata,
      })
      .from(organization)
      .where(
        and(
          or(
            mentions(organization.logo),
            mentions(organization.whitelabelSettings),
            mentions(organization.metadata)
          ),
          gt(organization.id, afterId)
        )
      )
      .orderBy(organization.id)
      .limit(URL_ROW_PAGE_SIZE)
      .then((rows) =>
        rows.map((row) => ({ id: row.id, values: [row.logo, row.whitelabel, row.metadata] }))
      ),
]

/**
 * Adds to `named` every key a stored asset URL names, reading only rows whose URL columns mention
 * one of `runs` (see {@link ownerRun}), page by page.
 */
async function loadKeysNamedByUrls(runs: readonly string[], named: Set<string>): Promise<void> {
  const mentions = (column: SQLWrapper): SQL =>
    sql`(${sql.join(
      runs.map((run) => sql`${column}::text LIKE ${`%${run}%`}`),
      sql` OR `
    )})`
  for (const page of URL_ROW_PAGES) {
    let afterId = ''
    for (;;) {
      const rows = await page(mentions, afterId)
      for (const row of rows) {
        const values: string[] = []
        collectStrings(row.values, values)
        for (const value of values) for (const key of keysNamedByUrl(value)) named.add(key)
      }
      if (rows.length < URL_ROW_PAGE_SIZE) break
      afterId = rows[rows.length - 1].id
    }
  }
}

/**
 * Builds the check every account-deletion purge runs before deleting a key. A key is kept when:
 *
 * - a row still names it: `workspace_files.key`, `workspace_file.key`,
 *   `workspace_file_version.key`, `document.storage_key`, `execution_large_values.key`;
 * - it sits under a workspace-keyed root of a workspace that still exists
 *   ({@link keysUnderLiveWorkspaces}); or
 * - it sits under a world-readable root (`isPublicStorageKey`, the same prefixes the file-serve
 *   route's `isPublicByKeyPrefix` answers without a session) and a stored asset URL names it.
 *   Only URL rows that mention the key's {@link ownerRun} are read, on every call so a reference
 *   written mid-sweep still counts; a public key without one is kept unread. A URL that
 *   hand-encodes characters of that run is missed. Account deletion asks about public keys only
 *   under a deleted workspace's prefix (its logos) and for the avatar the erased account's
 *   `user.image` names, so such a URL can cost one of those, and only when no surviving reference
 *   names it the way this app writes URLs; another user's own `user.image` naming their avatar
 *   always keeps it.
 *
 * No URL column is read for any other key: `verifyFileAccess` serves it only through a row, by its
 * key path under a workspace that still exists (kept above), or by object metadata to a signed-in holder of a hand-pasted URL to
 * a private file this deletion means to erase.
 *
 * Every row of a deleted workspace or account is gone when this runs, so a remaining reference
 * belongs to data that outlived the deletion — a moved knowledge base, a handed-off file, an
 * organization logo. References embedded in free-form JSON or text — workflow sub-block values,
 * chat messages, Markdown links — are not consulted; for the deleted account's own chat
 * attachments that is the intended erasure. A failed lookup throws, so nothing is deleted.
 */
export function createStorageReferenceGuard(): (keys: readonly string[]) => Promise<Set<string>> {
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
    const runs = new Set<string>()
    for (const key of publicKeys) {
      const run = ownerRun(key)
      if (run) runs.add(run)
      else referenced.add(key)
    }
    const named = new Set<string>()
    for (const batch of chunkArray([...runs], OWNER_RUNS_PER_QUERY))
      await loadKeysNamedByUrls(batch, named)
    for (const key of publicKeys) if (named.has(key)) referenced.add(key)
    for (const key of await keysUnderLiveWorkspaces(list)) referenced.add(key)
    return referenced
  }
}
