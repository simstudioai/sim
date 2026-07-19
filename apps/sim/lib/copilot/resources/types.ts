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
  return (
    resource.type === 'generic' || resource.type === 'browser' || resource.id === 'streaming-file'
  )
}

/**
 * Singleton id for the live browser-session panel. The panel hosts the
 * desktop app's natively embedded browser view — pure client-side UI with no
 * server row behind it — so the resource is ephemeral and never persisted to
 * the chat.
 */
export const BROWSER_SESSION_RESOURCE_ID = 'browser-session'

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
