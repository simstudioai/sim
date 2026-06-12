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
  page: 'page',
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
 * Workspace area pages that can be opened as chat resource tabs.
 * Keys double as the page's route segment under `/workspace/[workspaceId]/`.
 */
export const MOTHERSHIP_PAGES = {
  tables: 'Tables',
  knowledge: 'Knowledge Base',
  logs: 'Logs',
  'scheduled-tasks': 'Scheduled Tasks',
} as const
export type MothershipPageId = keyof typeof MOTHERSHIP_PAGES

export function isMothershipPageId(id: string): id is MothershipPageId {
  return id in MOTHERSHIP_PAGES
}

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
  folders: 'folder',
} as const
