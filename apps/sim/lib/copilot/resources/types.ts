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

export function isEphemeralResource(resource: MothershipResource): boolean {
  // The terminal is a live desktop panel backed by a PTY, not an addressable
  // workspace entity — there is nothing about it worth persisting with a chat.
  return (
    resource.type === 'generic' || resource.type === 'terminal' || resource.id === 'streaming-file'
  )
}

/**
 * Singleton id for the live browser-session panel. The panel hosts the
 * desktop app's natively embedded browser view. Only this resource metadata
 * is persisted with the chat; the live page and browser profile remain owned
 * by the desktop app.
 */
export const BROWSER_SESSION_RESOURCE_ID = 'browser-session'

/**
 * Singleton id for the live terminal panel. As with the browser, only this
 * resource metadata is persisted with the chat; the shell process and its
 * scrollback stay owned by the desktop app.
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
