import { z } from 'zod'
import { noInputSchema, workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
} from '@/lib/api/contracts/v2/shared'
import { v2OperationReportSchema } from '@/lib/api/contracts/v2/workspace-operations'
import {
  forkMappableResourceTypeSchema,
  forkRemapKindSchema,
  forkResourceSelectionSchema,
  promoteCopyResourcesSchema,
} from '@/lib/api/contracts/workspace-fork'

export const v2ForkParamsSchema = z
  .object({ workspaceId: workspaceIdSchema.describe('Explicit current workspace scope.') })
  .strict()
export const v2ForkRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .describe(
    'Stable client request ID. Reuse it with identical inputs after an uncertain response; changed inputs return 409.'
  )
export const v2ForkFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe(
    'Fingerprint from a preview with the same choices. A changed plan returns 409; request a new preview.'
  )
export const v2ForkMappingSchema = z
  .object({
    resourceType: forkMappableResourceTypeSchema.describe(
      'Resource type stored on the canonical parent/child edge.'
    ),
    sourceId: z
      .string()
      .min(1)
      .max(4096)
      .describe('Source resource identifier in the canonical source workspace.'),
    targetId: z
      .string()
      .min(1)
      .max(4096)
      .nullable()
      .describe('Authorized destination identifier, or null to clear the mapping.'),
  })
  .strict()
export const v2ForkDependentValueSchema = z
  .object({
    sourceWorkflowId: workflowIdSchema.describe('Workflow identifier in the source workspace.'),
    sourceBlockId: z.string().min(1).max(256).describe('Block identifier in the source workflow.'),
    subBlockKey: z
      .string()
      .min(1)
      .max(1024)
      .describe('Registered source field key, including the tool index for nested Agent fields.'),
    value: z.string().max(65536).describe('Destination value for the registered dependent field.'),
  })
  .strict()
export const v2SyncTriggerMappingSchema = z
  .object({
    sourceWorkflowId: workflowIdSchema.describe('Workflow identifier in the source workspace.'),
    sourceBlockId: z
      .string()
      .min(1)
      .max(256)
      .describe('Source trigger block identifier from the sync preview.'),
    adoptPath: z
      .string()
      .min(1)
      .max(4096)
      .nullable()
      .describe('An adoptable path offered for this trigger, or null to allocate a new path.'),
  })
  .strict()
export type V2SyncTriggerMapping = z.input<typeof v2SyncTriggerMappingSchema>

export const v2SyncTriggerSlotSchema = z
  .object({
    sourceWorkflowId: workflowIdSchema.describe('Workflow identifier in the source workspace.'),
    sourceBlockId: z
      .string()
      .min(1)
      .max(256)
      .describe('Stable source trigger block identifier to use in trigger mappings.'),
    blockName: z.string().max(1024).describe('Display name of the source trigger block.'),
    workflowName: z.string().max(1024).describe('Display name of the source workflow.'),
    ownPath: z
      .string()
      .max(4096)
      .nullable()
      .describe('Existing target trigger path, preserved automatically and not configurable.'),
    adoptablePaths: z
      .array(z.string().min(1).max(4096))
      .max(1000)
      .describe('Retiring paths in the same target workflow with a compatible trigger provider.'),
    defaultAdoptPath: z
      .string()
      .max(4096)
      .nullable()
      .describe('Default adoption when ownPath is null; null then allocates a new path.'),
  })
  .strict()
export type V2SyncTriggerSlot = z.output<typeof v2SyncTriggerSlotSchema>

export const v2ForkCopySelectionSchema = forkResourceSelectionSchema
  .extend({
    files: forkResourceSelectionSchema.shape.files.describe('Workspace file IDs to copy.'),
    tables: forkResourceSelectionSchema.shape.tables.describe(
      'Source table identifiers whose schemas and rows are copied.'
    ),
    knowledgeBases: forkResourceSelectionSchema.shape.knowledgeBases.describe(
      'Source knowledge base identifiers whose documents and content are copied.'
    ),
    customTools: forkResourceSelectionSchema.shape.customTools.describe(
      'Source custom tool identifiers to copy.'
    ),
    skills: forkResourceSelectionSchema.shape.skills.describe('Source skill identifiers to copy.'),
    mcpServers: forkResourceSelectionSchema.shape.mcpServers.describe(
      'External MCP server identifiers to copy; OAuth connections require authorization in the destination.'
    ),
    workflowMcpServers: forkResourceSelectionSchema.shape.workflowMcpServers.describe(
      'Workflow-publishing MCP server identifiers to copy as empty configuration shells.'
    ),
  })
  .strict()
export const v2SyncCopySelectionSchema = promoteCopyResourcesSchema
  .extend({
    files: promoteCopyResourcesSchema.shape.files.describe('Workspace file storage keys to copy.'),
    tables: promoteCopyResourcesSchema.shape.tables.describe(
      'Source table identifiers whose schemas and rows are copied.'
    ),
    knowledgeBases: promoteCopyResourcesSchema.shape.knowledgeBases.describe(
      'Source knowledge base identifiers whose documents and content are copied.'
    ),
    customTools: promoteCopyResourcesSchema.shape.customTools.describe(
      'Source custom tool identifiers to copy.'
    ),
    skills: promoteCopyResourcesSchema.shape.skills.describe('Source skill identifiers to copy.'),
    mcpServers: promoteCopyResourcesSchema.shape.mcpServers.describe(
      'External MCP server identifiers to copy; OAuth connections require authorization in the destination.'
    ),
  })
  .strict()
export const v2ForkPreviewBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Display name of the workflow or workspace.'),
    copy: v2ForkCopySelectionSchema
      .optional()
      .describe(
        'Explicit resource selections to copy into the new fork; omitted resource kinds are not copied.'
      ),
  })
  .strict()
export const v2ForkApplyBodySchema = v2ForkPreviewBodySchema
  .extend({
    requestId: v2ForkRequestIdSchema.describe(
      'Stable client request ID for reconciliation and identical retries.'
    ),
    previewFingerprint: v2ForkFingerprintSchema.describe(
      'Fingerprint of the reviewed preview and its choices.'
    ),
  })
  .strict()
export const v2SyncPreviewBodySchema = z
  .object({
    otherWorkspaceId: workspaceIdSchema.describe(
      'Workspace on the other side of the direct fork edge.'
    ),
    mappings: z
      .array(v2ForkMappingSchema)
      .max(5000)
      .optional()
      .describe('Proposed mappings; preview does not save them. Apply commits them with the sync.')
      .describe('Mappings keyed by resource type and source identifier.'),
    dependentValues: z
      .array(v2ForkDependentValueSchema)
      .max(2000)
      .optional()
      .describe('Destination choices addressed by source workflow, block, and field identities.')
      .describe(
        'Destination-dependent choices keyed by source workflow, block, and field identities.'
      ),
    copyResources: v2SyncCopySelectionSchema
      .optional()
      .describe('Explicit source resources to copy before syncing the workflows.'),
    dropReferences: z
      .array(
        z
          .object({
            kind: forkRemapKindSchema.describe('Resource or operation kind.'),
            sourceId: z
              .string()
              .min(1)
              .max(4096)
              .describe('Source resource identifier in the canonical source workspace.'),
          })
          .strict()
      )
      .max(2000)
      .optional()
      .describe(
        'Source-deleted references explicitly acknowledged for removal; live source references cannot be dropped.'
      ),
    triggerMappings: z
      .array(v2SyncTriggerMappingSchema)
      .max(500)
      .optional()
      .describe(
        'Public trigger path choices from preview.triggerSlots, addressed by source workflow and block IDs. Duplicate or unavailable choices are rejected.'
      ),
  })
  .strict()
export const v2SyncApplyBodySchema = v2SyncPreviewBodySchema
  .extend({
    requestId: v2ForkRequestIdSchema.describe(
      'Stable client request ID for reconciliation and identical retries.'
    ),
    previewFingerprint: v2ForkFingerprintSchema.describe(
      'Fingerprint of the reviewed preview and its choices.'
    ),
    confirm: z
      .literal(true)
      .describe(
        'Acknowledge replacement of target workflows and archival of mapped targets whose sources were deleted.'
      )
      .describe('Explicit acknowledgement that sync replaces target workflows.'),
  })
  .strict()
export const v2ForkPreviewDataSchema = z
  .object({
    previewFingerprint: v2ForkFingerprintSchema.describe(
      'Fingerprint of the reviewed preview and its choices.'
    ),
    sourceWorkspaceId: workspaceIdSchema.describe(
      'Canonical workspace the workflows and resources are copied from.'
    ),
    workflows: z
      .array(
        z.object({
          sourceWorkflowId: workflowIdSchema.describe(
            'Workflow identifier in the source workspace.'
          ),
          name: z.string().max(1024).describe('Display name of the workflow or workspace.'),
        })
      )
      .max(1000)
      .describe('Eligible workflows and their planned actions.'),
    selectedResourceCount: z
      .number()
      .int()
      .min(0)
      .describe('Number of resources explicitly selected for copying.'),
    draftOnly: z.literal(true).describe('True because fork creation produces undeployed drafts.'),
  })
  .meta({
    id: 'WorkspaceForkPreview',
    title: 'WorkspaceForkPreview',
    description: 'The WorkspaceForkPreview result.',
  })
export const v2SyncConfigurationSchema = z.object({
  sourceWorkflowId: workflowIdSchema.describe('Workflow identifier in the source workspace.'),
  sourceBlockId: z.string().max(256).describe('Block identifier in the source workflow.'),
  subBlockKey: z
    .string()
    .max(1024)
    .describe('Registered source field key, including the tool index for nested Agent fields.'),
  title: z.string().max(1024).describe('Human-readable configuration field label.'),
  required: z
    .boolean()
    .describe('Whether the reference or configuration is required for this operation.'),
  currentValue: z
    .string()
    .max(65536)
    .describe('Persisted sync override or proposed override; empty when neither is configured.'),
  multiSelect: z
    .boolean()
    .optional()
    .describe('Whether the field accepts comma-separated selections.'),
  selectorKey: z
    .string()
    .max(256)
    .optional()
    .describe('Registered selector key for discovering this field’s options.'),
  discoveryWorkspaceId: workspaceIdSchema.describe(
    'Workspace scope for selector discovery: source for a parent being copied, otherwise destination.'
  ),
  context: z
    .record(z.string().max(256), z.string().max(4096))
    .describe('Allowlisted selector dependencies scoped to discoveryWorkspaceId.'),
  parentKind: forkRemapKindSchema.describe('Resource kind that owns this dependent configuration.'),
  parentSourceId: z
    .string()
    .max(4096)
    .describe('Source identifier of the parent resource being mapped.'),
  parentContextKey: z
    .string()
    .max(256)
    .optional()
    .describe('Selector context key supplied by the mapped parent resource.'),
})
export const v2SyncPreviewDataSchema = z
  .object({
    previewFingerprint: v2ForkFingerprintSchema.describe(
      'Fingerprint of the reviewed preview and its choices.'
    ),
    sourceWorkspaceId: workspaceIdSchema.describe(
      'Canonical workspace the workflows and resources are copied from.'
    ),
    targetWorkspaceId: workspaceIdSchema.describe('Canonical workspace receiving the changes.'),
    ready: z
      .boolean()
      .describe('Whether the operation passes its current apply or deployment readiness checks.'),
    workflows: z
      .array(
        z.object({
          action: z
            .enum(['create', 'replace', 'archive'])
            .describe('Planned workflow creation, replacement, or archival.'),
          sourceWorkflowId: workflowIdSchema
            .optional()
            .describe('Workflow identifier in the source workspace.'),
          targetWorkflowId: workflowIdSchema
            .optional()
            .describe(
              'Existing target workflow identifier; absent when apply will create a new target.'
            ),
          name: z.string().max(1024).describe('Display name of the workflow or workspace.'),
        })
      )
      .max(2000)
      .describe('Eligible workflows and their planned actions.'),
    unresolvedBindings: z
      .array(
        z.object({
          kind: z.string().max(256).describe('Resource or operation kind.'),
          sourceId: z
            .string()
            .max(4096)
            .describe('Source resource identifier in the canonical source workspace.'),
          blockName: z
            .string()
            .max(1024)
            .optional()
            .describe('Display name of the affected source block.'),
          reason: z
            .string()
            .max(256)
            .optional()
            .describe('Structured explanation of the unresolved binding.'),
        })
      )
      .max(10000)
      .describe(
        'Source references that still require destination mappings or explicit copy choices.'
      ),
    configuration: z
      .array(v2SyncConfigurationSchema)
      .max(10000)
      .describe('Dependent fields that may need destination-specific values.'),
    excludedTargets: z
      .array(
        z.object({
          id: workflowIdSchema.describe('Resource identifier.'),
          name: z.string().max(1024).describe('Display name of the workflow or workspace.'),
        })
      )
      .max(1000)
      .describe('Target workflows explicitly excluded from sync.'),
    triggerSlots: z
      .array(v2SyncTriggerSlotSchema)
      .max(10000)
      .describe('Source triggers and the target paths available for explicit adoption choices.'),
    triggerUrlChanges: z
      .array(
        z.object({
          workflowName: z.string().max(1024).describe('Name of the affected workflow.'),
          path: z
            .string()
            .max(4096)
            .describe('Public trigger path that stops serving after this sync.'),
        })
      )
      .max(1000)
      .describe('Retiring target trigger URLs no arriving trigger adopts.'),
  })
  .meta({
    id: 'WorkspaceSyncPreview',
    title: 'WorkspaceSyncPreview',
    description: 'The WorkspaceSyncPreview result.',
  })
export const v2ForkOtherBodySchema = z
  .object({
    otherWorkspaceId: workspaceIdSchema.describe(
      'Workspace on the other side of the direct fork edge.'
    ),
  })
  .strict()
export const v2ForkMappingQuerySchema = z
  .object({
    otherWorkspaceId: workspaceIdSchema.describe(
      'Workspace on the other side of the direct fork edge.'
    ),
    direction: z
      .enum(['push', 'pull'])
      .describe(
        'Push means current to other; pull means other to current, independent of parent/child orientation.'
      ),
    ...v2PaginationFields(),
    sortBy: z.enum(['id']).default('id').describe('Supported stable sort key for this collection.'),
    sortOrder: z.enum(['asc']).default('asc').describe('Sort direction.'),
  })
  .strict()
export const v2ForkMappingUpdateBodySchema = z
  .object({
    otherWorkspaceId: workspaceIdSchema.describe(
      'Workspace on the other side of the direct fork edge.'
    ),
    direction: z
      .enum(['push', 'pull'])
      .describe(
        'Push means current to other; pull means other to current, independent of parent/child orientation.'
      ),
    mappings: z
      .array(v2ForkMappingSchema)
      .max(5000)
      .describe('Mappings keyed by resource type and source identifier.'),
  })
  .strict()
export const v2ForkChildrenQuerySchema = z
  .object({
    ...v2PaginationFields(),
    sortBy: z
      .enum(['createdAt'])
      .default('createdAt')
      .describe('Supported stable sort key for this collection.'),
    sortOrder: z.enum(['desc']).default('desc').describe('Sort direction.'),
  })
  .strict()
export const v2ForkResourcesQuerySchema = z
  .object({
    ...v2PaginationFields(),
    kind: z
      .enum([
        'files',
        'tables',
        'knowledgeBases',
        'customTools',
        'skills',
        'mcpServers',
        'workflowMcpServers',
      ])
      .describe('Resource or operation kind.'),
    sortBy: z.enum(['id']).default('id').describe('Supported stable sort key for this collection.'),
    sortOrder: z.enum(['asc']).default('asc').describe('Sort direction.'),
  })
  .strict()
export const v2ForkExclusionsBodySchema = z
  .object({
    workflowIds: z
      .array(workflowIdSchema)
      .min(1)
      .max(1000)
      .describe('Workflow identifiers in the current workspace.'),
    forkSyncExcluded: z
      .boolean()
      .describe('Whether the named workflows should be skipped as sync sources and targets.'),
  })
  .strict()
export const v2ForkLineageNodeSchema = z.object({
  id: workspaceIdSchema.describe('Resource identifier.'),
  name: z.string().max(1024).describe('Display name of the workflow or workspace.'),
  organizationId: z
    .string()
    .nullable()
    .describe('Owning organization, or null for a personal workspace.'),
})

export const v2PreviewWorkspaceForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/preview',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkPreviewBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ForkPreviewDataSchema) },
})

export const v2ForkWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkApplyBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2OperationReportSchema) },
})

export const v2PreviewWorkspacePushContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/push/preview',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2SyncPreviewBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2SyncPreviewDataSchema) },
})

export const v2PushWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/push',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2SyncApplyBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2OperationReportSchema) },
})

export const v2PreviewWorkspacePullContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/pull/preview',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2SyncPreviewBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2SyncPreviewDataSchema) },
})

export const v2PullWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/pull',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2SyncApplyBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2OperationReportSchema) },
})

export const v2GetWorkspaceForkAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/fork/availability',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          available: z
            .boolean()
            .describe('Whether this deployment and workspace plan enable forking.'),
        })
        .meta({
          id: 'GetWorkspaceForkAvailabilityResult',
          title: 'GetWorkspaceForkAvailabilityResult',
          description: 'The GetWorkspaceForkAvailabilityResult result.',
        })
    ),
  },
})

export const v2GetWorkspaceForkLineageContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/fork/lineage',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          current: v2ForkLineageNodeSchema.describe('The current workspace lineage node.'),
          parent: v2ForkLineageNodeSchema
            .nullable()
            .describe('The live parent workspace, or null when this workspace is not a fork.'),
        })
        .meta({
          id: 'GetWorkspaceForkLineageResult',
          title: 'GetWorkspaceForkLineageResult',
          description: 'The GetWorkspaceForkLineageResult result.',
        })
    ),
  },
})

export const v2ListWorkspaceForkChildrenContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/fork/children',
  params: v2ForkParamsSchema,
  query: v2ForkChildrenQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(
      v2ForkLineageNodeSchema
        .extend({ createdAt: z.iso.datetime().describe('ISO 8601 creation timestamp.') })
        .meta({
          id: 'ListWorkspaceForkChildrenResult',
          title: 'ListWorkspaceForkChildrenResult',
          description: 'The ListWorkspaceForkChildrenResult result.',
        })
    ),
  },
})

export const v2ListWorkspaceForkResourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/fork/resources',
  params: v2ForkParamsSchema,
  query: v2ForkResourcesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(
      z
        .object({
          id: z.string().max(4096).describe('Resource identifier.'),
          label: z.string().max(1024).describe('Human-readable resource label.'),
          folderId: z
            .string()
            .nullable()
            .optional()
            .describe('Containing folder identifier, or null at the workspace root.'),
          folderName: z
            .string()
            .nullable()
            .optional()
            .describe('Containing folder name, or null at the workspace root.'),
        })
        .meta({
          id: 'ListWorkspaceForkResourcesResult',
          title: 'ListWorkspaceForkResourcesResult',
          description: 'The ListWorkspaceForkResourcesResult result.',
        })
    ),
  },
})

export const v2GetWorkspaceForkMappingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workspaces/[workspaceId]/fork/mappings',
  params: v2ForkParamsSchema,
  query: v2ForkMappingQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(
      v2ForkMappingSchema
        .extend({ id: z.string().max(256).describe('Resource identifier.') })
        .meta({
          id: 'GetWorkspaceForkMappingsResult',
          title: 'GetWorkspaceForkMappingsResult',
          description: 'The GetWorkspaceForkMappingsResult result.',
        })
    ),
  },
})

export const v2UpdateWorkspaceForkMappingsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/workspaces/[workspaceId]/fork/mappings',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkMappingUpdateBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({ updated: z.number().int().min(0).describe('Number of records changed.') }).meta({
        id: 'UpdateWorkspaceForkMappingsResult',
        title: 'UpdateWorkspaceForkMappingsResult',
        description: 'The UpdateWorkspaceForkMappingsResult result.',
      })
    ),
  },
})

export const v2RollbackWorkspaceForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/rollback',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkOtherBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z
        .object({
          restored: z
            .number()
            .int()
            .min(0)
            .describe('Workflows restored to their prior deployed version.'),
          archived: z
            .number()
            .int()
            .min(0)
            .describe('Workflows created by the sync and now archived.'),
          unarchived: z
            .number()
            .int()
            .min(0)
            .describe('Previously archived workflows restored by rollback.'),
          skipped: z
            .number()
            .int()
            .min(0)
            .describe('Snapshot workflows no longer available to restore.'),
          pendingActivations: z
            .array(z.string().max(256))
            .max(1000)
            .describe('Workflows whose restored deployment is still activating.'),
        })
        .meta({
          id: 'RollbackWorkspaceForkResult',
          title: 'RollbackWorkspaceForkResult',
          description: 'The RollbackWorkspaceForkResult result.',
        })
    ),
  },
})

export const v2UnlinkWorkspaceForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/workspaces/[workspaceId]/fork/unlink',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkOtherBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({ unlinked: z.boolean().describe('Whether the fork edge was removed.') }).meta({
        id: 'UnlinkWorkspaceForkResult',
        title: 'UnlinkWorkspaceForkResult',
        description: 'The UnlinkWorkspaceForkResult result.',
      })
    ),
  },
})

export const v2UpdateWorkspaceForkExclusionsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/workspaces/[workspaceId]/fork/exclusions',
  params: v2ForkParamsSchema,
  query: noInputSchema,
  body: v2ForkExclusionsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      z.object({ updated: z.number().int().min(0).describe('Number of records changed.') }).meta({
        id: 'UpdateWorkspaceForkExclusionsResult',
        title: 'UpdateWorkspaceForkExclusionsResult',
        description: 'The UpdateWorkspaceForkExclusionsResult result.',
      })
    ),
  },
})
export type V2ForkPreviewBody = z.input<typeof v2ForkPreviewBodySchema>
export type V2ForkApplyBody = z.input<typeof v2ForkApplyBodySchema>
export type V2SyncPreviewBody = z.input<typeof v2SyncPreviewBodySchema>
export type V2SyncApplyBody = z.input<typeof v2SyncApplyBodySchema>
export type V2ForkOtherBody = z.input<typeof v2ForkOtherBodySchema>
export type V2ForkMappingQuery = z.input<typeof v2ForkMappingQuerySchema>
export type V2ForkMappingUpdateBody = z.input<typeof v2ForkMappingUpdateBodySchema>
export type V2ForkChildrenQuery = z.input<typeof v2ForkChildrenQuerySchema>
export type V2ForkResourcesQuery = z.input<typeof v2ForkResourcesQuerySchema>
export type V2ForkExclusionsBody = z.input<typeof v2ForkExclusionsBodySchema>
export type V2ForkPreviewData = z.output<typeof v2ForkPreviewDataSchema>
export type V2SyncPreviewData = z.output<typeof v2SyncPreviewDataSchema>
export type V2SyncConfiguration = z.output<typeof v2SyncConfigurationSchema>
