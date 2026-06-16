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
  return resource.type === 'generic' || resource.id === 'streaming-file'
}

/**
 * Placeholder resource titles emitted before a specific name is known. A more
 * specific title may overwrite one of these during dedup; a specific title is
 * never downgraded back to a placeholder. Shared by the chat-resource route and
 * the server-side persistence merge so the two stay in lockstep.
 */
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
} as const
