export const MothershipResourceType = {
  table: 'table',
  file: 'file',
  workflow: 'workflow',
  knowledgebase: 'knowledgebase',
  folder: 'folder',
  filefolder: 'filefolder',
  task: 'task',
  log: 'log',
  integration: 'integration',
  skill: 'skill',
  custom_tool: 'custom_tool',
  mcp_server: 'mcp_server',
  generic: 'generic',
  browser: 'browser',
  terminal: 'terminal',
} as const
export type MothershipResourceType =
  (typeof MothershipResourceType)[keyof typeof MothershipResourceType]

export interface MothershipResource {
  type: MothershipResourceType
  id: string
  title: string
  path?: string
  /** Saved table view to open pinned (type "table" only). */
  viewId?: string
  /**
   * The run this log row records (type "log" only). Distinct from `id`, which
   * is the log row's own key: the tab loads by row id, while chat context and
   * the logs deep-link address the run itself.
   */
  executionId?: string
}

/**
 * What a chip in an assistant message knows about the resource it points at,
 * before it has been resolved. The agent writes these tags as text, so a file
 * it just created is usually named but not yet identified. A ref becomes a
 * {@link MothershipResource} only through resolution, which may fail — see
 * {@link isAddressableResource} for why the unresolved state is modelled rather
 * than filled in.
 */
export interface WorkspaceResourceRef {
  type: MothershipResourceType
  id?: string
  path?: string
  title: string
}

interface ResourcePolicy {
  /** Stored with the chat, so the tab is still there when the chat is reopened. */
  persisted: boolean
  /**
   * Backed by something only the desktop app can provide. Still persisted, but
   * a client without the bridge leaves the tab out rather than restoring a
   * panel with nothing behind it.
   */
  desktopOnly?: boolean
}

/**
 * What the app does with each kind of resource, in one place.
 *
 * These rules used to live in three, and they disagreed. A client-side check
 * decided what to send, a Zod enum in the API contract decided what to accept,
 * and a runtime allowlist in the route handler decided again — but the enum
 * rejected `browser`, `task` and `integration` before the allowlist that
 * permitted them ever ran. Those tabs looked fine until the chat was reopened,
 * because the write had been failing the whole time into a warning log. The
 * contract enum and the handler now derive from this table, so a type can no
 * longer be openable and unsaveable at the same time.
 */
const RESOURCE_POLICY: Record<MothershipResourceType, ResourcePolicy> = {
  table: { persisted: true },
  file: { persisted: true },
  workflow: { persisted: true },
  knowledgebase: { persisted: true },
  folder: { persisted: true },
  filefolder: { persisted: true },
  task: { persisted: true },
  log: { persisted: true },
  integration: { persisted: true },
  skill: { persisted: true },
  custom_tool: { persisted: true },
  mcp_server: { persisted: true },
  // A synthetic panel with no addressable entity behind it to reopen.
  generic: { persisted: false },
  browser: { persisted: true, desktopOnly: true },
  terminal: { persisted: true, desktopOnly: true },
}

/**
 * Resource types the chat will store. The API contract builds its enum from
 * this, which is what keeps client and server from drifting.
 */
export const PERSISTED_RESOURCE_TYPES = (
  Object.keys(RESOURCE_POLICY) as MothershipResourceType[]
).filter((type) => RESOURCE_POLICY[type].persisted) as [
  MothershipResourceType,
  ...MothershipResourceType[],
]

/** True when the resource's panel needs the desktop bridge to show anything. */
export function isDesktopOnlyResource(resource: MothershipResource): boolean {
  return RESOURCE_POLICY[resource.type]?.desktopOnly === true
}

export function isEphemeralResource(resource: MothershipResource): boolean {
  // The in-flight file preview is a placeholder that becomes a real file once
  // the write lands, so persisting it would restore a tab for a file that was
  // never created.
  if (resource.id === 'streaming-file') return true
  // An unrecognized type is treated as ephemeral: the server would reject it
  // anyway, and failing to store it is better than a write that always errors.
  return !RESOURCE_POLICY[resource.type]?.persisted
}

/**
 * Singleton id for the live browser-session panel, which hosts the desktop
 * app's natively embedded browser view. Only this metadata is stored with the
 * chat: reopening restores the tab, while the page and browser profile stay
 * owned by the desktop app.
 */
export const BROWSER_SESSION_RESOURCE_ID = 'browser-session'

/**
 * Singleton id for the live terminal panel. As with the browser, only the
 * metadata is stored — reopening the chat brings the panel back with a fresh
 * shell, since the pty and its scrollback belong to the desktop app and do not
 * outlive it.
 */
export const TERMINAL_SESSION_RESOURCE_ID = 'terminal-session'

/**
 * Collapses page/shell-shaped metadata onto the one top-level desktop panel
 * each chat can restore. Browser pages and terminal tabs are inner tabs, not
 * independently addressable Mothership resources.
 */
export function canonicalizeDesktopSessionResource(
  resource: MothershipResource
): MothershipResource {
  if (resource.type === 'browser') {
    return { type: 'browser', id: BROWSER_SESSION_RESOURCE_ID, title: 'Browser' }
  }
  if (resource.type === 'terminal') {
    return { type: 'terminal', id: TERMINAL_SESSION_RESOURCE_ID, title: 'Terminal' }
  }
  return resource
}

/**
 * Whether an id value names something the app can act on.
 *
 * This is the definition every layer defers to, so they cannot disagree about
 * whitespace. Takes `unknown` because two of its callers validate untrusted
 * input — a stream payload and a chat request body — before it has a type.
 */
export function hasAddressableId(id: unknown): boolean {
  return typeof id === 'string' && id.trim().length > 0
}

/**
 * True when the resource names something the app can actually act on.
 *
 * A blank id points at nothing: it cannot be opened, resolved into agent
 * context, or even removed, since the resources API requires a non-empty
 * `resourceId` to delete. Storing one used to be possible, and it made the chat
 * reject every later message — the write contract accepted `id: ''` while the
 * send schema required `min(1)`.
 */
export function isAddressableResource(resource: MothershipResource): boolean {
  return hasAddressableId(resource.id)
}

/**
 * Canonicalizes and deduplicates the singleton desktop panels in display order.
 * Module-private: callers want {@link sanitizeChatResources}, which also drops
 * unaddressable resources.
 */
function canonicalizeDesktopSessionResources(
  resources: readonly MothershipResource[]
): MothershipResource[] {
  const seenDesktopTypes = new Set<'browser' | 'terminal'>()
  const canonical: MothershipResource[] = []

  for (const resource of resources) {
    if (resource.type === 'browser' || resource.type === 'terminal') {
      if (seenDesktopTypes.has(resource.type)) continue
      seenDesktopTypes.add(resource.type)
    }
    canonical.push(canonicalizeDesktopSessionResource(resource))
  }

  return canonical
}

/**
 * The canonical form of a chat's resource list: singleton desktop panels
 * collapsed, unaddressable resources dropped. Every path that reads or writes
 * stored resources goes through this, which is what heals chats that already
 * hold one. Canonicalization runs first, so the browser and terminal panels —
 * which are given their ids there — are never dropped for arriving without one.
 */
export function sanitizeChatResources(
  resources: readonly MothershipResource[]
): MothershipResource[] {
  return canonicalizeDesktopSessionResources(resources).filter(isAddressableResource)
}

/** Placeholder resource titles that a more specific title may overwrite during dedup. */
export const GENERIC_RESOURCE_TITLES = new Set<string>([
  'Table',
  'File',
  'Workflow',
  'Knowledge Base',
  'Folder',
  'Log',
  'Integration',
  'Skill',
  'Custom Tool',
  'MCP Server',
])

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
  folders: 'folder',
} as const
