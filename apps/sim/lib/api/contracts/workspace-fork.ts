import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { workspaceSchema } from '@/lib/api/contracts/workspaces'

const workspaceIdParamsSchema = z.object({ id: nonEmptyIdSchema })

export const forkRemapKindSchema = z.enum([
  'credential',
  'env-var',
  'knowledge-base',
  'knowledge-document',
  'table',
  'file',
  'mcp-server',
  'custom-tool',
  'skill',
])

export const forkResourceTypeSchema = z.enum([
  'workflow',
  'oauth_credential',
  'service_account_credential',
  'env_var',
  'table',
  'knowledge_base',
  'knowledge_document',
  'file',
  'mcp_server',
  'custom_tool',
  'skill',
])

/**
 * Resource types a user may map via the mapping editor. Excludes `workflow`:
 * workflow identity is system-managed (seeded at fork, maintained by promote,
 * dissolved by rollback) and must never be written through the mapping editor, or
 * a crafted entry could repoint a promote at the wrong target workflow.
 */
export const forkMappableResourceTypeSchema = forkResourceTypeSchema.exclude(['workflow'])
export type ForkMappableResourceType = z.infer<typeof forkMappableResourceTypeSchema>

export const forkDirectionSchema = z.enum(['push', 'pull'])

export const forkLineageNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string().nullable(),
})

export const getForkLineageContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/lineage',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      workspaceId: z.string(),
      parent: forkLineageNodeSchema.nullable(),
      /** The most recent undoable promote into this workspace, for the rollback UI. */
      undoableRun: z
        .object({
          otherWorkspaceId: z.string(),
          otherName: z.string(),
          direction: forkDirectionSchema,
        })
        .nullable(),
    }),
  },
})
export type ForkLineageNodeApi = z.output<typeof forkLineageNodeSchema>
export type GetForkLineageResponse = z.output<typeof getForkLineageContract.response.schema>

const forkResourceIdList = z.array(nonEmptyIdSchema).max(2000).optional()

export const forkResourceSelectionSchema = z.object({
  files: forkResourceIdList,
  tables: forkResourceIdList,
  knowledgeBases: forkResourceIdList,
  customTools: forkResourceIdList,
  skills: forkResourceIdList,
  mcpServers: forkResourceIdList,
})

export const forkWorkspaceBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long').optional(),
  copy: forkResourceSelectionSchema.optional(),
})
export const forkWorkspaceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork',
  params: workspaceIdParamsSchema,
  body: forkWorkspaceBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      // Full workspace row so the client can merge it into the workspace-list cache
      // (parity with create), not just the lineage node.
      workspace: workspaceSchema,
      workflowsCopied: z.number().int(),
    }),
  },
})
export type ForkWorkspaceBody = z.input<typeof forkWorkspaceBodySchema>
export type ForkWorkspaceResponse = z.output<typeof forkWorkspaceContract.response.schema>

export const forkCopyableResourceSchema = z.object({ id: z.string(), label: z.string() })
export type ForkCopyableResource = z.output<typeof forkCopyableResourceSchema>
export const getForkResourcesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/resources',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      files: z.array(forkCopyableResourceSchema),
      tables: z.array(forkCopyableResourceSchema),
      knowledgeBases: z.array(forkCopyableResourceSchema),
      customTools: z.array(forkCopyableResourceSchema),
      skills: z.array(forkCopyableResourceSchema),
      mcpServers: z.array(forkCopyableResourceSchema),
      deployedWorkflowCount: z.number().int(),
    }),
  },
})
export type GetForkResourcesResponse = z.output<typeof getForkResourcesContract.response.schema>

export const forkMappingCandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerId: z.string().optional(),
})

export const forkMappingEntrySchema = z.object({
  kind: forkRemapKindSchema,
  resourceType: forkMappableResourceTypeSchema,
  sourceId: z.string(),
  sourceLabel: z.string(),
  targetId: z.string().nullable(),
  required: z.boolean(),
  candidates: z.array(forkMappingCandidateSchema),
  /**
   * True when the target workspace has more candidates of this kind than the picker
   * loads, so the list shown is partial. The UI surfaces a "refine to find more"
   * notice; the chosen target is validated by exact id on save (never capped).
   */
  candidatesTruncated: z.boolean(),
})
export type ForkMappingEntry = z.output<typeof forkMappingEntrySchema>

export const getForkMappingQuerySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema.default('push'),
})
export const getForkMappingContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/mapping',
  params: workspaceIdParamsSchema,
  query: getForkMappingQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      childWorkspaceId: z.string(),
      parentWorkspaceId: z.string(),
      sourceWorkspaceId: z.string(),
      targetWorkspaceId: z.string(),
      entries: z.array(forkMappingEntrySchema),
    }),
  },
})
export type GetForkMappingResponse = z.output<typeof getForkMappingContract.response.schema>

export const updateForkMappingBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
  entries: z
    .array(
      z.object({
        resourceType: forkMappableResourceTypeSchema,
        sourceId: z.string().min(1),
        targetId: z.string().min(1).nullable(),
      })
    )
    .max(5000),
})
export const updateForkMappingContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/fork/mapping',
  params: workspaceIdParamsSchema,
  body: updateForkMappingBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), updated: z.number().int() }),
  },
})
export type UpdateForkMappingBody = z.input<typeof updateForkMappingBodySchema>

export const forkUnmappedReferenceSchema = z.object({
  kind: forkRemapKindSchema,
  sourceId: z.string(),
  required: z.boolean(),
  blockName: z.string().optional(),
})

export const forkWorkflowChangeSchema = z.object({
  action: z.enum(['update', 'create', 'archive']),
  /** Workflow name in the workspace the modal is open in. */
  currentName: z.string(),
  /** Workflow name in the sync-partner workspace (differs from `currentName` after a rename). */
  otherName: z.string(),
})

export const getForkDiffQuerySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
})
export const getForkDiffContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/fork/diff',
  params: workspaceIdParamsSchema,
  query: getForkDiffQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sourceWorkspaceId: z.string(),
      targetWorkspaceId: z.string(),
      willUpdate: z.number().int(),
      willCreate: z.number().int(),
      willArchive: z.number().int(),
      /** Per-workflow change list for the sync preview. */
      workflows: z.array(forkWorkflowChangeSchema),
      unmappedRequired: z.array(forkUnmappedReferenceSchema),
      unmappedOptional: z.array(forkUnmappedReferenceSchema),
      /** Source MCP server ids that use OAuth and need re-authorization in the target. */
      mcpReauthServerIds: z.array(z.string()),
      /** Review-only descriptions of inline secrets that cannot be id-mapped. */
      inlineSecretSources: z.array(z.string()),
      drift: z.boolean(),
    }),
  },
})
export type GetForkDiffResponse = z.output<typeof getForkDiffContract.response.schema>
export type ForkWorkflowChange = z.output<typeof forkWorkflowChangeSchema>

export const promoteForkBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
  direction: forkDirectionSchema,
  force: z.boolean().optional().default(false),
})
export const promoteForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork/promote',
  params: workspaceIdParamsSchema,
  body: promoteForkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      promoteRunId: z.string(),
      updated: z.number().int(),
      created: z.number().int(),
      archived: z.number().int(),
      redeployed: z.number().int(),
      deployFailed: z.number().int(),
      unmappedRequired: z.array(forkUnmappedReferenceSchema),
      drift: z.boolean(),
    }),
  },
})
export type PromoteForkBody = z.input<typeof promoteForkBodySchema>
export type PromoteForkResponse = z.output<typeof promoteForkContract.response.schema>

/** Structured detail for a background job, surfaced in the Activity tab's expand row. */
export const backgroundWorkMetadataSchema = z
  .object({
    /** Display name of the user who performed the action (denormalized at write time). */
    actorName: z.string().optional(),
    // Fork content copy
    childWorkspaceId: z.string().optional(),
    childWorkspaceName: z.string().optional(),
    workflowsCopied: z.number().int().optional(),
    tables: z.number().int().optional(),
    knowledgeBases: z.number().int().optional(),
    files: z.number().int().optional(),
    copied: z.number().int().optional(),
    failed: z.number().int().optional(),
    /** Names of the resources a fork copied, by kind, for the report breakdown. */
    workflowNames: z.array(z.string()).optional(),
    tableNames: z.array(z.string()).optional(),
    knowledgeBaseNames: z.array(z.string()).optional(),
    fileNames: z.array(z.string()).optional(),
    customToolNames: z.array(z.string()).optional(),
    skillNames: z.array(z.string()).optional(),
    mcpServerNames: z.array(z.string()).optional(),
    // Sync / rollback
    otherWorkspaceName: z.string().optional(),
    direction: z.enum(['push', 'pull']).optional(),
    updated: z.number().int().optional(),
    created: z.number().int().optional(),
    archived: z.number().int().optional(),
    redeployed: z.number().int().optional(),
    deployFailed: z.number().int().optional(),
    restored: z.number().int().optional(),
    unarchived: z.number().int().optional(),
    removed: z.number().int().optional(),
    skipped: z.number().int().optional(),
    /** Names of the workflows a sync changed, by action, for the report breakdown. */
    updatedNames: z.array(z.string()).optional(),
    createdNames: z.array(z.string()).optional(),
    archivedNames: z.array(z.string()).optional(),
  })
  .nullable()
export const backgroundWorkItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workflowId: z.string().nullable(),
  kind: z.enum(['deployment_side_effects', 'fork_content_copy', 'fork_sync', 'fork_rollback']),
  status: z.enum(['pending', 'processing', 'completed', 'completed_with_warnings', 'failed']),
  message: z.string().nullable(),
  error: z.string().nullable(),
  metadata: backgroundWorkMetadataSchema,
  startedAt: z.string(),
  completedAt: z.string().nullable(),
})
export type BackgroundWorkMetadata = z.output<typeof backgroundWorkMetadataSchema>
export const getWorkspaceBackgroundWorkContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/background-work',
  params: workspaceIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ items: z.array(backgroundWorkItemSchema) }),
  },
})
export type BackgroundWorkItem = z.output<typeof backgroundWorkItemSchema>
export type GetWorkspaceBackgroundWorkResponse = z.output<
  typeof getWorkspaceBackgroundWorkContract.response.schema
>

export const rollbackForkBodySchema = z.object({
  otherWorkspaceId: workspaceIdSchema,
})
export const rollbackForkContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/fork/rollback',
  params: workspaceIdParamsSchema,
  body: rollbackForkBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      restored: z.number().int(),
      archived: z.number().int(),
      unarchived: z.number().int(),
      /** Snapshot workflows that no longer exist and couldn't be reactivated. */
      skipped: z.number().int(),
    }),
  },
})
export type RollbackForkBody = z.input<typeof rollbackForkBodySchema>
export type RollbackForkResponse = z.output<typeof rollbackForkContract.response.schema>
