export type MothershipResourceType =
  | 'table'
  | 'file'
  | 'workflow'
  | 'knowledgebase'
  | 'folder'
  | 'task'
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

/** MIME type for a single dragged resource (used by resource-tabs internal reordering). */
export const SIM_RESOURCE_DRAG_TYPE = 'application/x-sim-resource' as const

/** MIME type for an array of dragged resources (used by sidebar drag-to-chat). */
export const SIM_RESOURCES_DRAG_TYPE = 'application/x-sim-resources' as const
