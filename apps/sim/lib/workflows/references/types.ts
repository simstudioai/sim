import type { PortableResourceKind } from '@sim/workflow-types/resources'

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
