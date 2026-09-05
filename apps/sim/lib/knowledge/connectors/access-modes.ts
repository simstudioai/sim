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
 * An optional dedicated credential supplies content while members only list
 * visibility, when the connector guarantees shared document identity and body.
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
 * The modes the content engine drives, which are also the modes that sync
 * with one stored credential of their own — the one a switch into the mode
 * must name, and the one the row keeps.
 *
 * `admin` belongs here and `members` does not: an admin-mode connector is
 * structurally a workspace crawl that ends with a different ACL, while a
 * members-mode connector owns its observation graph and may optionally run the
 * same content pass under its member lease with a dedicated credential.
 */
export const CONTENT_ENGINE_ACCESS_MODES = ['workspace', 'admin'] as const

export type ContentEngineAccessMode = (typeof CONTENT_ENGINE_ACCESS_MODES)[number]

export function isContentEngineAccessMode(
  accessMode: string
): accessMode is ContentEngineAccessMode {
  return CONTENT_ENGINE_ACCESS_MODES.some((mode) => mode === accessMode)
}

/**
 * The modes whose documents carry the source's own permissions, mirrored onto
 * each row by the crawl that lists it.
 *
 * Every run of such a mode lists the whole corpus. An incremental listing
 * returns only documents whose content changed, and a permission change moves
 * no content: re-sharing a file does not touch its modified time in Drive, and
 * restricting a page does not touch its version in Confluence. A revoked grant
 * on an unchanged document would otherwise stand until a full sync happened to
 * run. Listing everything costs metadata pages only; content is still hydrated
 * by hash, so unchanged documents are never re-fetched or re-embedded.
 */
export const MIRRORING_ACCESS_MODES = ['admin'] as const

export function mirrorsSourceAcls(accessMode: string): boolean {
  return MIRRORING_ACCESS_MODES.some((mode) => mode === accessMode)
}

/**
 * Whether this mode's ACL is owned by a pass other than the content sync.
 *
 * A workspace-mode connector's documents are visible to the whole workspace on
 * insert and on every update. `members` and `admin` both derive their ACL from
 * something the content sync does not know — who observed the document, or what
 * the source's own permissions say — so their documents are born hidden and made
 * visible by a separate pass, and a content update never touches the ACL. Born
 * hidden is what makes the fail-closed direction the default: a document indexed
 * before its ACL is known is invisible, never workspace-wide. It also means a
 * listing cap has no place in these modes: a capped listing would hide
 * everything past the cap and never see a removal.
 */
export function aclIsDerived(accessMode: ConnectorAccessMode): boolean {
  return accessMode !== 'workspace'
}

/** Automatic permission refresh leaves ample headroom below the 24-hour evidence lifetime. */
export const MAX_PERMISSION_REFRESH_INTERVAL_MINUTES = 60

/** Configured zero stays manual; source-derived access refreshes at least hourly. */
export function effectiveConnectorSyncIntervalMinutes(
  accessMode: ConnectorAccessMode,
  configuredMinutes: number
): number {
  return aclIsDerived(accessMode) && configuredMinutes > 0
    ? Math.min(configuredMinutes, MAX_PERMISSION_REFRESH_INTERVAL_MINUTES)
    : configuredMinutes
}
