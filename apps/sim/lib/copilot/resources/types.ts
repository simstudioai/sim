export const MothershipResourceType = {
  table: 'table',
  file: 'file',
  workflow: 'workflow',
  knowledgebase: 'knowledgebase',
  folder: 'folder',
  filefolder: 'filefolder',
  task: 'task',
  scheduledtask: 'scheduledtask',
  log: 'log',
  integration: 'integration',
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
  scheduledtask: { persisted: true },
  log: { persisted: true },
  integration: { persisted: true },
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

/** Placeholder resource titles that a more specific title may overwrite during dedup. */
export const GENERIC_RESOURCE_TITLES = new Set<string>([
  'Table',
  'File',
  'Workflow',
  'Knowledge Base',
  'Folder',
  'Scheduled Task',
  'Log',
])

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
  folders: 'folder',
  jobs: 'scheduledtask',
} as const
