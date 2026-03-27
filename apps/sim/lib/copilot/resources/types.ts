export const MothershipResourceType = {
  table: 'table',
  file: 'file',
  workflow: 'workflow',
  knowledgebase: 'knowledgebase',
  generic: 'generic',
} as const
export type MothershipResourceType =
  (typeof MothershipResourceType)[keyof typeof MothershipResourceType]

export interface MothershipResource {
  type: MothershipResourceType
  id: string
  title: string
}

export function isEphemeralResource(resource: MothershipResource): boolean {
  return resource.type === 'generic' || resource.id === 'streaming-file'
}

export const VFS_DIR_TO_RESOURCE: Record<string, MothershipResourceType> = {
  tables: 'table',
  files: 'file',
  workflows: 'workflow',
  knowledgebases: 'knowledgebase',
} as const
