export type MothershipResourceType = 'table' | 'file' | 'workflow' | 'knowledgebase'

export interface MothershipResource {
  type: MothershipResourceType
  id: string
  title: string
}

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
} as const

export const RESOURCE_TYPE_TO_DIR: Record<MothershipResourceType, string> = {
  table: 'tables',
  file: 'files',
  workflow: 'workflows',
  knowledgebase: 'knowledgebases',
} as const
