export const MothershipResourceType = {
  table: 'table',
  interface: 'interface',
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

/** Placeholder resource titles that a more specific title may overwrite during dedup. */
export const GENERIC_RESOURCE_TITLES = new Set<string>([
  'Table',
  'Interface',
  'File',
  'Workflow',
  'Knowledge Base',
  'Folder',
  'Scheduled Task',
  'Log',
])

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  interfaces: 'interface',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
  folders: 'folder',
  jobs: 'scheduledtask',
} as const
