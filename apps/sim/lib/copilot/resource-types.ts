export type MothershipResourceType =
  | 'table'
  | 'file'
  | 'workflow'
  | 'knowledgebase'
  | 'folder'
  | 'generic'

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
  folders: 'folder',
} as const
