import {
  documentedSchema,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetSelectorContract, v2ListSelectorContract } from '@/lib/api/contracts/v2/selectors'
import { v2PreviewWorkflowImportContract } from '@/lib/api/contracts/v2/workflows'
import {
  v2ForkWorkspaceContract,
  v2GetWorkspaceForkAvailabilityContract,
  v2GetWorkspaceForkLineageContract,
  v2GetWorkspaceForkMappingsContract,
  v2ListWorkspaceForkChildrenContract,
  v2ListWorkspaceForkResourcesContract,
  v2PreviewWorkspaceForkContract,
  v2PreviewWorkspacePullContract,
  v2PreviewWorkspacePushContract,
  v2PullWorkspaceContract,
  v2PushWorkspaceContract,
  v2RollbackWorkspaceForkContract,
  v2UnlinkWorkspaceForkContract,
  v2UpdateWorkspaceForkExclusionsContract,
  v2UpdateWorkspaceForkMappingsContract,
} from '@/lib/api/contracts/v2/workspace-fork'
import {
  v2GetWorkspaceOperationContract,
  v2ListWorkspaceOperationsContract,
} from '@/lib/api/contracts/v2/workspace-operations'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { selectorOperations } from '@/lib/selectors/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { workspaceOperations } from '@/lib/workspaces/operations/operations'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

const FORKING_REQUIREMENT =
  'Billing-enabled deployments require Enterprise. Billing-disabled deployments require forking to be enabled by deployment feature configuration, such as `FORKING_ENABLED`.'

const PREVIEW_FINGERPRINT_EXAMPLE =
  'c7d158e8cbc5137a2d0a4fc37ddaeb51a3b9757485679a6ad82a7de3fdac4e3a'

export const workspaceSyncOpenApiRoutes = [
  defineOpenApiRoute(
    v2PreviewWorkspaceForkContract,
    {
      applicationOperation: forkOperations.preview,
      operationId: 'previewWorkspaceFork',
      summary: 'Preview workspace fork',
      description: `Preview deployed workflows and explicitly selected resources for a new child workspace. Requires source workspace Admin access and permission to create a workspace in its organization. The read-only result supplies the fingerprint for Fork workspace with the same choices. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Deployed source workflows, selected-copy count, and a preview fingerprint.',
      },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspaceForkContract.params,
        'PreviewWorkspaceForkParams',
        'Preview workspace fork path parameters',
        'Source workspace'
      ),
      query: documentedSchema(
        v2PreviewWorkspaceForkContract.query,
        'PreviewWorkspaceForkQuery',
        'Preview workspace fork query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PreviewWorkspaceForkContract.body,
        'PreviewWorkspaceForkBody',
        'Preview workspace fork request',
        'Optional child name and explicitly selected resource copies.'
      ),
      response: documentedSchema(
        v2PreviewWorkspaceForkContract.response.schema,
        'PreviewWorkspaceForkResponse',
        'Preview workspace fork response',
        'Deployed source workflows, selected-copy count, and a preview fingerprint.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ForkWorkspaceContract,
    {
      applicationOperation: forkOperations.create,
      operationId: 'forkWorkspace',
      summary: 'Fork workspace',
      description: `Create a child workspace with undeployed drafts of the source's deployed workflows. Requires source workspace Admin access and permission to create a workspace in its organization. ${FORKING_REQUIREMENT}\n\nFirst preview the same name and copy choices, then send the returned fingerprint and a stable request ID. The example fingerprint is illustrative. Identical retries return the same committed operation; changed inputs with that ID return \`409\`. Poll Get workspace operation until selected resource copies finish. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Committed fork receipt and resource-copy progress.' },
    },
    {
      params: documentedSchema(
        v2ForkWorkspaceContract.params,
        'ForkWorkspaceParams',
        'Fork workspace path parameters',
        'Source workspace'
      ),
      query: documentedSchema(
        v2ForkWorkspaceContract.query,
        'ForkWorkspaceQuery',
        'Fork workspace query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2ForkWorkspaceContract.body,
        'ForkWorkspaceBody',
        'Fork workspace request',
        'Child name and copy choices, with the actual preview fingerprint and a stable request ID.',
        [
          {
            name: 'Support sandbox',
            requestId: 'fork-support-2026-10-13',
            previewFingerprint: PREVIEW_FINGERPRINT_EXAMPLE,
          },
        ]
      ),
      response: documentedSchema(
        v2ForkWorkspaceContract.response.schema,
        'ForkWorkspaceResponse',
        'Fork workspace response',
        'Committed fork receipt and resource-copy progress.',
        [
          {
            data: {
              operationId: 'e4f8d2b6-9a1c-4e3d-8b7f-5c0a2d9e6f13',
              requestId: 'fork-support-2026-10-13',
              workspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
              kind: 'workspace_fork',
              applied: true,
              status: 'processing',
              resourceIds: ['destination_workflow_id'],
              issues: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkspacePushContract,
    {
      applicationOperation: forkOperations.syncPreview,
      operationId: 'previewWorkspacePush',
      summary: 'Preview workspace push',
      description: `Preview changes from this workspace into the other workspace along a direct fork edge. Requires Admin access to both workspaces. The plan lists workflows to create, replace, or archive; replacements overwrite target drafts with the source deployment. Proposed mappings are not saved. Dependent choices use source workflow, block, and field IDs. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description:
          'Current-to-other workflow actions, required choices, and preview fingerprint.',
      },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspacePushContract.params,
        'PreviewWorkspacePushParams',
        'Preview workspace push path parameters',
        'Acting source workspace'
      ),
      query: documentedSchema(
        v2PreviewWorkspacePushContract.query,
        'PreviewWorkspacePushQuery',
        'Preview workspace push query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PreviewWorkspacePushContract.body,
        'PreviewWorkspacePushBody',
        'Preview workspace push request',
        'Other workspace and proposed source-to-target sync choices.'
      ),
      response: documentedSchema(
        v2PreviewWorkspacePushContract.response.schema,
        'PreviewWorkspacePushResponse',
        'Preview workspace push response',
        'Current-to-other workflow actions, required choices, and preview fingerprint.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PushWorkspaceContract,
    {
      applicationOperation: forkOperations.sync,
      operationId: 'pushWorkspace',
      summary: 'Push workspace',
      description: `Apply a reviewed sync from this workspace into the other workspace along a direct fork edge. Requires Admin access to both workspaces. Creates unmatched deployed workflows, overwrites mapped target drafts, and archives mapped targets whose sources were deleted or archived. Undeployed sources alone do not archive targets. ${FORKING_REQUIREMENT}\n\nSend \`confirm: true\`, the fingerprint from a preview with identical choices, and a stable request ID. The example hash is illustrative. Changed or unresolved plans return \`409\` without applying. Identical retries return the committed operation; changed inputs with that ID return \`409\`. Copies and deployment activation can finish after the transaction commits. Poll Get workspace operation before treating the target as ready. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Committed push receipt with copy and deployment readiness.' },
    },
    {
      params: documentedSchema(
        v2PushWorkspaceContract.params,
        'PushWorkspaceParams',
        'Push workspace path parameters',
        'Acting source workspace'
      ),
      query: documentedSchema(
        v2PushWorkspaceContract.query,
        'PushWorkspaceQuery',
        'Push workspace query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PushWorkspaceContract.body,
        'PushWorkspaceBody',
        'Push workspace request',
        'Confirmed current-to-other choices, actual preview fingerprint, and stable request ID.',
        [
          {
            otherWorkspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
            requestId: 'push-support-2026-10-13',
            previewFingerprint: PREVIEW_FINGERPRINT_EXAMPLE,
            confirm: true,
          },
        ]
      ),
      response: documentedSchema(
        v2PushWorkspaceContract.response.schema,
        'PushWorkspaceResponse',
        'Push workspace response',
        'Committed push receipt with copy and deployment readiness.',
        [
          {
            data: {
              operationId: 'e4f8d2b6-9a1c-4e3d-8b7f-5c0a2d9e6f13',
              requestId: 'push-support-2026-10-13',
              workspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
              kind: 'workspace_push',
              applied: true,
              status: 'processing',
              resourceIds: ['destination_workflow_id'],
              issues: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkspacePullContract,
    {
      applicationOperation: forkOperations.syncPreview,
      operationId: 'previewWorkspacePull',
      summary: 'Preview workspace pull',
      description: `Preview changes from the other workspace into this workspace along a direct fork edge. Requires Admin access to both workspaces. The plan lists workflows to create, replace, or archive; replacements overwrite target drafts with the source deployment. Proposed mappings are not saved. Dependent choices use source workflow, block, and field IDs. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description:
          'Other-to-current workflow actions, required choices, and preview fingerprint.',
      },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspacePullContract.params,
        'PreviewWorkspacePullParams',
        'Preview workspace pull path parameters',
        'Acting target workspace'
      ),
      query: documentedSchema(
        v2PreviewWorkspacePullContract.query,
        'PreviewWorkspacePullQuery',
        'Preview workspace pull query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PreviewWorkspacePullContract.body,
        'PreviewWorkspacePullBody',
        'Preview workspace pull request',
        'Other workspace and proposed source-to-target sync choices.'
      ),
      response: documentedSchema(
        v2PreviewWorkspacePullContract.response.schema,
        'PreviewWorkspacePullResponse',
        'Preview workspace pull response',
        'Other-to-current workflow actions, required choices, and preview fingerprint.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PullWorkspaceContract,
    {
      applicationOperation: forkOperations.sync,
      operationId: 'pullWorkspace',
      summary: 'Pull workspace',
      description: `Apply a reviewed sync from the other workspace into this workspace along a direct fork edge. Requires Admin access to both workspaces. Creates unmatched deployed workflows, overwrites mapped target drafts, and archives mapped targets whose sources were deleted or archived. Undeployed sources alone do not archive targets. ${FORKING_REQUIREMENT}\n\nSend \`confirm: true\`, the fingerprint from a preview with identical choices, and a stable request ID. The example hash is illustrative. Changed or unresolved plans return \`409\` without applying. Identical retries return the committed operation; changed inputs with that ID return \`409\`. Copies and deployment activation can finish after the transaction commits. Poll Get workspace operation before treating the target as ready. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Committed pull receipt with copy and deployment readiness.' },
    },
    {
      params: documentedSchema(
        v2PullWorkspaceContract.params,
        'PullWorkspaceParams',
        'Pull workspace path parameters',
        'Acting target workspace'
      ),
      query: documentedSchema(
        v2PullWorkspaceContract.query,
        'PullWorkspaceQuery',
        'Pull workspace query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2PullWorkspaceContract.body,
        'PullWorkspaceBody',
        'Pull workspace request',
        'Confirmed other-to-current choices, actual preview fingerprint, and stable request ID.',
        [
          {
            otherWorkspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
            requestId: 'pull-support-2026-10-13',
            previewFingerprint: PREVIEW_FINGERPRINT_EXAMPLE,
            confirm: true,
          },
        ]
      ),
      response: documentedSchema(
        v2PullWorkspaceContract.response.schema,
        'PullWorkspaceResponse',
        'Pull workspace response',
        'Committed pull receipt with copy and deployment readiness.',
        [
          {
            data: {
              operationId: 'e4f8d2b6-9a1c-4e3d-8b7f-5c0a2d9e6f13',
              requestId: 'pull-support-2026-10-13',
              workspaceId: '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94',
              kind: 'workspace_pull',
              applied: true,
              status: 'processing',
              resourceIds: ['destination_workflow_id'],
              issues: [],
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkAvailabilityContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'getWorkspaceForkAvailability',
      summary: 'Get workspace fork availability',
      description: `Check whether workspace forking is enabled for this deployment and workspace plan. Requires workspace Admin access. Returns \`available: false\` when the feature gate is unmet. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Whether forking is enabled for this deployment and workspace plan.',
      },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.params,
        'GetWorkspaceForkAvailabilityParams',
        'Get workspace fork availability path parameters',
        'Workspace to check'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.query,
        'GetWorkspaceForkAvailabilityQuery',
        'Get workspace fork availability query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.response.schema,
        'GetWorkspaceForkAvailabilityResponse',
        'Get workspace fork availability response',
        'Whether forking is enabled for this deployment and workspace plan.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkLineageContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'getWorkspaceForkLineage',
      summary: 'Get workspace fork lineage',
      description: `Read this workspace and its direct parent, or \`parent: null\` when it has no active parent. Requires workspace Admin access. The relationship does not grant access to the parent. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Current workspace and its active direct parent, when present.' },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkLineageContract.params,
        'GetWorkspaceForkLineageParams',
        'Get workspace fork lineage path parameters',
        'Workspace to inspect'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkLineageContract.query,
        'GetWorkspaceForkLineageQuery',
        'Get workspace fork lineage query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkLineageContract.response.schema,
        'GetWorkspaceForkLineageResponse',
        'Get workspace fork lineage response',
        'Current workspace and its active direct parent, when present.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceForkChildrenContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'listWorkspaceForkChildren',
      summary: 'List workspace fork children',
      description: `List this workspace's active direct children, newest first, with cursor pagination. Requires workspace Admin access. A fork relationship does not grant access to a child workspace. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of active direct child workspaces.' },
    },
    {
      params: documentedSchema(
        v2ListWorkspaceForkChildrenContract.params,
        'ListWorkspaceForkChildrenParams',
        'List workspace fork children path parameters',
        'Parent workspace'
      ),
      query: documentedSchema(
        v2ListWorkspaceForkChildrenContract.query,
        'ListWorkspaceForkChildrenQuery',
        'List workspace fork children query',
        'Pagination for active direct children, newest first.'
      ),
      response: documentedSchema(
        v2ListWorkspaceForkChildrenContract.response.schema,
        'ListWorkspaceForkChildrenResponse',
        'List workspace fork children response',
        'A page of active direct child workspaces.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceForkResourcesContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'listWorkspaceForkResources',
      summary: 'List workspace fork resources',
      description: `List copyable resources of one kind in this workspace with cursor pagination. Requires workspace Admin access. Fork creation uses file IDs; sync copy choices use file storage keys from source references or file resource reads. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of copyable resource candidates.' },
    },
    {
      params: documentedSchema(
        v2ListWorkspaceForkResourcesContract.params,
        'ListWorkspaceForkResourcesParams',
        'List workspace fork resources path parameters',
        'Source workspace'
      ),
      query: documentedSchema(
        v2ListWorkspaceForkResourcesContract.query,
        'ListWorkspaceForkResourcesQuery',
        'List workspace fork resources query',
        'Resource kind and cursor pagination.'
      ),
      response: documentedSchema(
        v2ListWorkspaceForkResourcesContract.response.schema,
        'ListWorkspaceForkResourcesResponse',
        'List workspace fork resources response',
        'A page of copyable resource candidates.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkMappingsContract,
    {
      applicationOperation: forkOperations.mappingsRead,
      operationId: 'getWorkspaceForkMappings',
      summary: 'Get workspace fork mappings',
      description: `Read persisted resource mappings in the requested source-to-target direction along a direct fork edge. Requires Admin access to both workspaces. Discover candidates with destination resource reads and selector operations. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of persisted source-to-target mapping entries.' },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkMappingsContract.params,
        'GetWorkspaceForkMappingsParams',
        'Get workspace fork mappings path parameters',
        'Acting workspace'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkMappingsContract.query,
        'GetWorkspaceForkMappingsQuery',
        'Get workspace fork mappings query',
        'Other workspace, direction, and mapping pagination.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkMappingsContract.response.schema,
        'GetWorkspaceForkMappingsResponse',
        'Get workspace fork mappings response',
        'A page of persisted source-to-target mapping entries.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkspaceForkMappingsContract,
    {
      applicationOperation: forkOperations.mappingsUpdate,
      operationId: 'updateWorkspaceForkMappings',
      summary: 'Update workspace fork mappings',
      description: `Update mappings along a direct fork edge with Admin access to both workspaces. Destination resource membership and credential provider compatibility are validated. Push maps current-to-other; pull maps other-to-current. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Number of mapping records changed.' },
    },
    {
      params: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.params,
        'UpdateWorkspaceForkMappingsParams',
        'Update workspace fork mappings path parameters',
        'Acting workspace'
      ),
      query: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.query,
        'UpdateWorkspaceForkMappingsQuery',
        'Update workspace fork mappings query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.body,
        'UpdateWorkspaceForkMappingsBody',
        'Update workspace fork mappings request',
        'Other workspace, direction, and mapping entries to update.'
      ),
      response: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.response.schema,
        'UpdateWorkspaceForkMappingsResponse',
        'Update workspace fork mappings response',
        'Number of mapping records changed.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RollbackWorkspaceForkContract,
    {
      applicationOperation: forkOperations.rollback,
      operationId: 'rollbackWorkspaceFork',
      summary: 'Rollback workspace fork',
      description: `Restore the latest sync into this workspace from the named other workspace using prior deployed versions. Requires target workspace Admin access. A newer sync from another fork edge returns \`409\`. Arbitrary draft edits and copied resources are not restored or removed. Inspect \`pendingActivations\`; retry rollback if activation remains unfinished. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'Restored, archived, skipped, and still-activating workflow counts.',
      },
    },
    {
      params: documentedSchema(
        v2RollbackWorkspaceForkContract.params,
        'RollbackWorkspaceForkParams',
        'Rollback workspace fork path parameters',
        'Workspace receiving the rollback'
      ),
      query: documentedSchema(
        v2RollbackWorkspaceForkContract.query,
        'RollbackWorkspaceForkQuery',
        'Rollback workspace fork query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2RollbackWorkspaceForkContract.body,
        'RollbackWorkspaceForkBody',
        'Rollback workspace fork request',
        'Other workspace whose latest inbound sync should be undone.'
      ),
      response: documentedSchema(
        v2RollbackWorkspaceForkContract.response.schema,
        'RollbackWorkspaceForkResponse',
        'Rollback workspace fork response',
        'Restored, archived, skipped, and still-activating workflow counts.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UnlinkWorkspaceForkContract,
    {
      applicationOperation: forkOperations.unlink,
      operationId: 'unlinkWorkspaceFork',
      summary: 'Unlink workspace fork',
      description: `Remove the direct fork relationship and its mappings with Admin access to the acting workspace. Existing workflows and resources remain available. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Confirmation that the relationship was removed.' },
    },
    {
      params: documentedSchema(
        v2UnlinkWorkspaceForkContract.params,
        'UnlinkWorkspaceForkParams',
        'Unlink workspace fork path parameters',
        'Workspace severing the relationship'
      ),
      query: documentedSchema(
        v2UnlinkWorkspaceForkContract.query,
        'UnlinkWorkspaceForkQuery',
        'Unlink workspace fork query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UnlinkWorkspaceForkContract.body,
        'UnlinkWorkspaceForkBody',
        'Unlink workspace fork request',
        'Other workspace on the direct fork edge to remove.'
      ),
      response: documentedSchema(
        v2UnlinkWorkspaceForkContract.response.schema,
        'UnlinkWorkspaceForkResponse',
        'Unlink workspace fork response',
        'Confirmation that the relationship was removed.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkspaceForkExclusionsContract,
    {
      applicationOperation: forkOperations.exclusions,
      operationId: 'updateWorkspaceForkExclusions',
      summary: 'Update workspace fork exclusions',
      description: `Include or exclude selected workflows from fork sync with workspace Admin access. Excluded workflows are skipped as sources and targets. Missing, archived, and unchanged workflow IDs are skipped. ${FORKING_REQUIREMENT} ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Number of workflow exclusion flags changed.' },
    },
    {
      params: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.params,
        'UpdateWorkspaceForkExclusionsParams',
        'Update workspace fork exclusions path parameters',
        'Workspace holding the workflows'
      ),
      query: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.query,
        'UpdateWorkspaceForkExclusionsQuery',
        'Update workspace fork exclusions query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.body,
        'UpdateWorkspaceForkExclusionsBody',
        'Update workspace fork exclusions request',
        'Workflow IDs and whether to exclude them from sync.'
      ),
      response: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.response.schema,
        'UpdateWorkspaceForkExclusionsResponse',
        'Update workspace fork exclusions response',
        'Number of workflow exclusion flags changed.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkflowImportContract,
    {
      applicationOperation: workflowOperations.importPreview,
      operationId: 'previewWorkflowImport',
      summary: 'Preview workflow import',
      description:
        'Validate destination mappings and configuration with workspace write access, without creating a workflow. The result reports readiness, unresolved fields, discovery instructions, and a fingerprint for mapped import with the same choices. Imported provenance never authorizes or queries a source workspace.',
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description:
          'Import readiness, unresolved bindings, and destination discovery instructions.',
      },
    },
    {
      query: documentedSchema(
        v2PreviewWorkflowImportContract.query,
        'PreviewWorkflowImportQuery',
        'Preview workflow import query',
        'No query parameters.'
      ),
      body: v2PreviewWorkflowImportContract.body,
      response: documentedSchema(
        v2PreviewWorkflowImportContract.response.schema,
        'PreviewWorkflowImportResponse',
        'Preview workflow import response',
        'Import readiness, unresolved bindings, and destination discovery instructions.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'listSelector',
      summary: 'List selector options',
      description: `List authorized workspace configuration choices using the selector key and context from an import or sync preview. Requires workspace read access. Missing OAuth connections require human authorization. Keep workspace, selector, context, and search unchanged while paging; a changed provider page returns \`409\` and requires restarting without a cursor. Provider pages above 8 MiB return \`413\`; narrow the search. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'A page of authorized options, continuation cursor, and truncation status.',
      },
    },
    {
      query: documentedSchema(
        v2ListSelectorContract.query,
        'ListSelectorQuery',
        'List selector query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2ListSelectorContract.body,
        'ListSelectorBody',
        'List selector request',
        'Workspace, registered selector key, context, and optional search/cursor.'
      ),
      response: documentedSchema(
        v2ListSelectorContract.response.schema,
        'ListSelectorResponse',
        'List selector response',
        'A page of authorized options, continuation cursor, and truncation status.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'getSelector',
      summary: 'Get selector option',
      description: `Get an authorized configuration choice by provider ID and declared context with workspace read access. Returns \`data: null\` when the option is absent from complete results. Truncated results or pagination limits that prevent verification return \`413\`; a list-only lookup checks at most 100 pages or 10,000 options. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: {
        description: 'The authorized option, or data:null when absent from complete results.',
      },
    },
    {
      query: documentedSchema(
        v2GetSelectorContract.query,
        'GetSelectorQuery',
        'Get selector query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2GetSelectorContract.body,
        'GetSelectorBody',
        'Get selector request',
        'Workspace, registered selector key, context, and provider option ID.'
      ),
      response: documentedSchema(
        v2GetSelectorContract.response.schema,
        'GetSelectorResponse',
        'Get selector response',
        'The authorized option, or data:null when absent from complete results.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceOperationContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'getWorkspaceOperation',
      summary: 'Get workspace operation',
      description:
        'Read a committed operation and refresh its copy progress, exact admitted deployment readiness, and structured issues with workspace read access. `applied: true` means the transaction committed even if follow-up work failed. This read does not require the fork-specific Admin role or feature gate.',
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Refreshed commit, copy progress, and exact deployment readiness.' },
    },
    {
      query: documentedSchema(
        v2GetWorkspaceOperationContract.query,
        'GetWorkspaceOperationQuery',
        'Get workspace operation query',
        'No query parameters.'
      ),
      params: documentedSchema(
        v2GetWorkspaceOperationContract.params,
        'GetWorkspaceOperationParams',
        'Get workspace operation path parameters',
        'Workspace and committed operation ID'
      ),
      response: documentedSchema(
        v2GetWorkspaceOperationContract.response.schema,
        'GetWorkspaceOperationResponse',
        'Get workspace operation response',
        'Refreshed commit, copy progress, and exact deployment readiness.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceOperationsContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'listWorkspaceOperations',
      summary: 'List workspace operations',
      description:
        'List stored operation receipts newest first with workspace read access. Filter by the original `requestId` to reconcile an uncertain mutation response. Read an individual operation to refresh its copy and deployment readiness. This list does not require the fork-specific Admin role or feature gate.',
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'A page of stored operation receipts.' },
    },
    {
      query: documentedSchema(
        v2ListWorkspaceOperationsContract.query,
        'ListWorkspaceOperationsQuery',
        'List workspace operations query',
        'Request ID filter and newest-first cursor pagination.'
      ),
      params: documentedSchema(
        v2ListWorkspaceOperationsContract.params,
        'ListWorkspaceOperationsParams',
        'List workspace operations path parameters',
        'Workspace whose receipts to list'
      ),
      response: documentedSchema(
        v2ListWorkspaceOperationsContract.response.schema,
        'ListWorkspaceOperationsResponse',
        'List workspace operations response',
        'A page of stored operation receipts.'
      ),
    }
  ),
]
