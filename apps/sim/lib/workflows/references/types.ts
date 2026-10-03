/** Registered workspace references shared by workflow imports and fork synchronization. */
export const WORKFLOW_RESOURCE_KINDS = [
  'credential',
  'env-var',
  'knowledge-base',
  'knowledge-document',
  'table',
  'file',
  'file-folder',
  'mcp-server',
  'custom-tool',
  'custom-block',
  'skill',
  'sandbox',
] as const

export type WorkflowResourceKind = (typeof WORKFLOW_RESOURCE_KINDS)[number]
export type PortableResourceKind = WorkflowResourceKind | 'workflow'

export interface ReferenceOccurrence {
  blockId: string
  subBlockKey: string
  valuePath: Array<string | number>
  positions?: number[]
  encoding: 'scalar' | 'array' | 'csv' | 'files' | 'environment'
}

export interface PortableReference {
  kind: PortableResourceKind
  sourceId: string
  required: boolean
  occurrences: ReferenceOccurrence[]
}

export interface WorkflowReferenceManifest {
  version: 1
  references: PortableReference[]
}

/** Resolves a block identity in the destination graph; imports may use an identity resolver. */
export type WorkflowBlockIdResolver = (targetWorkflowId: string, sourceBlockId: string) => string
