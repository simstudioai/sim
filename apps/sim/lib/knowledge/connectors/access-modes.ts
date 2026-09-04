/**
 * How a connector decides who may read the documents it syncs, and which engine
 * that implies. A leaf module: the scheduler, the queue, the sync engine and the
 * persistence layer all read the same vocabulary, so the modes cannot drift
 * apart between the query that dispatches a run and the code that performs it.
 */

/**
 * `workspace` — every synced document is readable by the whole workspace.
 *
 * `members` — the source is crawled once per credential-group member with that
 * member's own token, and a document's ACL is the set of members whose crawl
 * returned it. Driven by the member engine.
 *
 * `admin` — the source is crawled once under an administrative credential and
 * each document's ACL is mirrored from the source's own permissions. Driven by
 * the content engine, because it is one crawl under one credential.
 */
export const CONNECTOR_ACCESS_MODES = ['workspace', 'members', 'admin'] as const

export type ConnectorAccessMode = (typeof CONNECTOR_ACCESS_MODES)[number]

export function isConnectorAccessMode(value: string): value is ConnectorAccessMode {
  return CONNECTOR_ACCESS_MODES.some((mode) => mode === value)
}

/**
 * The modes the content engine drives.
 *
 * `admin` belongs here and `members` does not: an admin-mode connector is
 * structurally a workspace crawl that ends with a different ACL, while a
 * members-mode connector is N crawls plus an observation graph, and its lease is
 * mutually exclusive with the content engine's.
 */
export const CONTENT_ENGINE_ACCESS_MODES = ['workspace', 'admin'] as const

export function isContentEngineAccessMode(accessMode: string): boolean {
  return CONTENT_ENGINE_ACCESS_MODES.some((mode) => mode === accessMode)
}

/**
 * Whether a connector in this mode syncs with one credential of its own —
 * the one a switch into the mode must name, and the one its row keeps. The
 * same set as the content engine's: a members-mode connector crawls with its
 * members' credentials and holds none itself.
 */
export function isCredentialBackedAccessMode(accessMode: string): boolean {
  return isContentEngineAccessMode(accessMode)
}

/**
 * Who may read a document a sync writes.
 *
 * A workspace-mode connector's documents are visible to the whole workspace on
 * insert and on every update. `members` and `admin` both derive their ACL from
 * something the content sync does not know — who observed the document, or what
 * the source's own permissions say — so their documents are born hidden and made
 * visible by a separate pass, and a content update never touches the ACL. Born
 * hidden is what makes the fail-closed direction the default: a document indexed
 * before its ACL is known is invisible, never workspace-wide.
 */
export type SyncDocumentAccess = 'workspace' | 'members' | 'admin'

/** Whether this mode's ACL is owned by a pass other than the content sync. */
export function aclIsDerived(access: SyncDocumentAccess): boolean {
  return access !== 'workspace'
}

/** How a content-engine run's writes decide who may read what they store. */
export function documentAccessForMode(accessMode: string): SyncDocumentAccess {
  return accessMode === 'admin' ? 'admin' : 'workspace'
}

/**
 * Whether every run of this mode must list the whole corpus.
 *
 * An incremental listing returns only documents whose content changed, and a
 * permission change moves no content: re-sharing a file does not touch its
 * modified time in Drive, and restricting a page does not touch its version in
 * Confluence. A mode whose ACLs are mirrored from the source therefore cannot
 * refresh them from an incremental listing — a revoked grant on an unchanged
 * document would stand until the next full sync happened to run. Listing
 * everything costs metadata pages only; content is still hydrated by hash, so
 * unchanged documents are never re-fetched or re-embedded.
 */
export function requiresFullListing(accessMode: string): boolean {
  return accessMode === 'admin'
}
