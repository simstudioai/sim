/**
 * Workspace resources a workflow can reference by internal id: the one vocabulary shared by
 * workflow imports, fork synchronization and workflow source (`@sim/workflow-code`).
 */
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

/** A resource kind that can cross workspaces: every workspace resource, plus another workflow. */
export type PortableResourceKind = WorkflowResourceKind | 'workflow'
