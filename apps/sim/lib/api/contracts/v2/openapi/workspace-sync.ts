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

export const workspaceSyncOpenApiRoutes = [
  defineOpenApiRoute(
    v2PreviewWorkspaceForkContract,
    {
      applicationOperation: forkOperations.preview,
      operationId: 'previewWorkspaceFork',
      summary: 'Preview Workspace Fork',
      description: `Preview the deployed workflows and explicitly selected resources that a new workspace fork would copy. The result is read-only and supplies the fingerprint required by Fork Workspace. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspaceForkContract.params,
        'PreviewWorkspaceForkParams',
        'PreviewWorkspaceFork params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2PreviewWorkspaceForkContract.query,
        'PreviewWorkspaceForkQuery',
        'PreviewWorkspaceFork query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2PreviewWorkspaceForkContract.body,
        'PreviewWorkspaceForkBody',
        'PreviewWorkspaceFork body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2PreviewWorkspaceForkContract.response.schema,
        'PreviewWorkspaceForkResponse',
        'PreviewWorkspaceFork response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ForkWorkspaceContract,
    {
      applicationOperation: forkOperations.create,
      operationId: 'forkWorkspace',
      summary: 'Fork Workspace',
      description: `Create a child workspace with undeployed workflow drafts. Requires the reviewed preview fingerprint and a stable request ID. Identical retries return the same operation; reuse with different inputs returns 409. Poll Get Workspace Operation until selected resource copies complete. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2ForkWorkspaceContract.params,
        'ForkWorkspaceParams',
        'ForkWorkspace params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2ForkWorkspaceContract.query,
        'ForkWorkspaceQuery',
        'ForkWorkspace query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2ForkWorkspaceContract.body,
        'ForkWorkspaceBody',
        'ForkWorkspace body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2ForkWorkspaceContract.response.schema,
        'ForkWorkspaceResponse',
        'ForkWorkspace response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkspacePushContract,
    {
      applicationOperation: forkOperations.syncPreview,
      operationId: 'previewWorkspacePush',
      summary: 'Preview Workspace Push',
      description: `Preview deployed source workflows replacing mapped targets along a direct fork edge. Push sends the current workspace to the other; pull brings the other into the current workspace. Proposed mappings are not saved. Dependent choices use source workflow, block, and field identities. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspacePushContract.params,
        'PreviewWorkspacePushParams',
        'PreviewWorkspacePush params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2PreviewWorkspacePushContract.query,
        'PreviewWorkspacePushQuery',
        'PreviewWorkspacePush query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2PreviewWorkspacePushContract.body,
        'PreviewWorkspacePushBody',
        'PreviewWorkspacePush body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2PreviewWorkspacePushContract.response.schema,
        'PreviewWorkspacePushResponse',
        'PreviewWorkspacePush response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PushWorkspaceContract,
    {
      applicationOperation: forkOperations.sync,
      operationId: 'pushWorkspace',
      summary: 'Push Workspace',
      description: `Apply a reviewed push or pull with inline mappings in one transaction. Requires confirmation, the preview fingerprint, and a stable request ID. Unresolved or changed plans return 409 without applying. The receipt distinguishes committed changes from copy and deployment readiness; poll Get Workspace Operation before treating the target as ready. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2PushWorkspaceContract.params,
        'PushWorkspaceParams',
        'PushWorkspace params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2PushWorkspaceContract.query,
        'PushWorkspaceQuery',
        'PushWorkspace query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2PushWorkspaceContract.body,
        'PushWorkspaceBody',
        'PushWorkspace body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2PushWorkspaceContract.response.schema,
        'PushWorkspaceResponse',
        'PushWorkspace response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkspacePullContract,
    {
      applicationOperation: forkOperations.syncPreview,
      operationId: 'previewWorkspacePull',
      summary: 'Preview Workspace Pull',
      description: `Preview deployed source workflows replacing mapped targets along a direct fork edge. Push sends the current workspace to the other; pull brings the other into the current workspace. Proposed mappings are not saved. Dependent choices use source workflow, block, and field identities. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2PreviewWorkspacePullContract.params,
        'PreviewWorkspacePullParams',
        'PreviewWorkspacePull params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2PreviewWorkspacePullContract.query,
        'PreviewWorkspacePullQuery',
        'PreviewWorkspacePull query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2PreviewWorkspacePullContract.body,
        'PreviewWorkspacePullBody',
        'PreviewWorkspacePull body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2PreviewWorkspacePullContract.response.schema,
        'PreviewWorkspacePullResponse',
        'PreviewWorkspacePull response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PullWorkspaceContract,
    {
      applicationOperation: forkOperations.sync,
      operationId: 'pullWorkspace',
      summary: 'Pull Workspace',
      description: `Apply a reviewed push or pull with inline mappings in one transaction. Requires confirmation, the preview fingerprint, and a stable request ID. Unresolved or changed plans return 409 without applying. The receipt distinguishes committed changes from copy and deployment readiness; poll Get Workspace Operation before treating the target as ready. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2PullWorkspaceContract.params,
        'PullWorkspaceParams',
        'PullWorkspace params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2PullWorkspaceContract.query,
        'PullWorkspaceQuery',
        'PullWorkspace query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2PullWorkspaceContract.body,
        'PullWorkspaceBody',
        'PullWorkspace body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2PullWorkspaceContract.response.schema,
        'PullWorkspaceResponse',
        'PullWorkspace response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkAvailabilityContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'getWorkspaceForkAvailability',
      summary: 'Get Workspace Fork Availability',
      description: `Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.params,
        'GetWorkspaceForkAvailabilityParams',
        'GetWorkspaceForkAvailability params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.query,
        'GetWorkspaceForkAvailabilityQuery',
        'GetWorkspaceForkAvailability query',
        'The query for this operation.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkAvailabilityContract.response.schema,
        'GetWorkspaceForkAvailabilityResponse',
        'GetWorkspaceForkAvailability response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkLineageContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'getWorkspaceForkLineage',
      summary: 'Get Workspace Fork Lineage',
      description: `Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkLineageContract.params,
        'GetWorkspaceForkLineageParams',
        'GetWorkspaceForkLineage params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkLineageContract.query,
        'GetWorkspaceForkLineageQuery',
        'GetWorkspaceForkLineage query',
        'The query for this operation.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkLineageContract.response.schema,
        'GetWorkspaceForkLineageResponse',
        'GetWorkspaceForkLineage response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceForkChildrenContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'listWorkspaceForkChildren',
      summary: 'List Workspace Fork Children',
      description: `Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2ListWorkspaceForkChildrenContract.params,
        'ListWorkspaceForkChildrenParams',
        'ListWorkspaceForkChildren params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2ListWorkspaceForkChildrenContract.query,
        'ListWorkspaceForkChildrenQuery',
        'ListWorkspaceForkChildren query',
        'The query for this operation.'
      ),
      response: documentedSchema(
        v2ListWorkspaceForkChildrenContract.response.schema,
        'ListWorkspaceForkChildrenResponse',
        'ListWorkspaceForkChildren response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceForkResourcesContract,
    {
      applicationOperation: forkOperations.discover,
      operationId: 'listWorkspaceForkResources',
      summary: 'List Workspace Fork Resources',
      description: `Inspect workspace fork information and copyable resources. Lineage does not grant access to the other workspace; fork creation requires source admin and sync requires admin on both sides. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2ListWorkspaceForkResourcesContract.params,
        'ListWorkspaceForkResourcesParams',
        'ListWorkspaceForkResources params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2ListWorkspaceForkResourcesContract.query,
        'ListWorkspaceForkResourcesQuery',
        'ListWorkspaceForkResources query',
        'The query for this operation.'
      ),
      response: documentedSchema(
        v2ListWorkspaceForkResourcesContract.response.schema,
        'ListWorkspaceForkResourcesResponse',
        'ListWorkspaceForkResources response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceForkMappingsContract,
    {
      applicationOperation: forkOperations.mappingsRead,
      operationId: 'getWorkspaceForkMappings',
      summary: 'Get Workspace Fork Mappings',
      description: `Read persisted mappings in the requested source-to-target direction. Candidate discovery uses the destination resource and selector listing operations. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2GetWorkspaceForkMappingsContract.params,
        'GetWorkspaceForkMappingsParams',
        'GetWorkspaceForkMappings params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2GetWorkspaceForkMappingsContract.query,
        'GetWorkspaceForkMappingsQuery',
        'GetWorkspaceForkMappings query',
        'The query for this operation.'
      ),
      response: documentedSchema(
        v2GetWorkspaceForkMappingsContract.response.schema,
        'GetWorkspaceForkMappingsResponse',
        'GetWorkspaceForkMappings response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkspaceForkMappingsContract,
    {
      applicationOperation: forkOperations.mappingsUpdate,
      operationId: 'updateWorkspaceForkMappings',
      summary: 'Update Workspace Fork Mappings',
      description: `Update edge mappings after validating destination resource membership and credential provider compatibility. Push addresses current-to-other mappings; pull addresses other-to-current mappings. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.params,
        'UpdateWorkspaceForkMappingsParams',
        'UpdateWorkspaceForkMappings params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.query,
        'UpdateWorkspaceForkMappingsQuery',
        'UpdateWorkspaceForkMappings query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.body,
        'UpdateWorkspaceForkMappingsBody',
        'UpdateWorkspaceForkMappings body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2UpdateWorkspaceForkMappingsContract.response.schema,
        'UpdateWorkspaceForkMappingsResponse',
        'UpdateWorkspaceForkMappings response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RollbackWorkspaceForkContract,
    {
      applicationOperation: forkOperations.rollback,
      operationId: 'rollbackWorkspaceFork',
      summary: 'Rollback Workspace Fork',
      description: `Restore the latest sync into this workspace using its prior deployed versions. Requires target admin. It does not restore arbitrary drafts or remove every copied resource. Pending activations are reported. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2RollbackWorkspaceForkContract.params,
        'RollbackWorkspaceForkParams',
        'RollbackWorkspaceFork params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2RollbackWorkspaceForkContract.query,
        'RollbackWorkspaceForkQuery',
        'RollbackWorkspaceFork query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2RollbackWorkspaceForkContract.body,
        'RollbackWorkspaceForkBody',
        'RollbackWorkspaceFork body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2RollbackWorkspaceForkContract.response.schema,
        'RollbackWorkspaceForkResponse',
        'RollbackWorkspaceFork response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UnlinkWorkspaceForkContract,
    {
      applicationOperation: forkOperations.unlink,
      operationId: 'unlinkWorkspaceFork',
      summary: 'Unlink Workspace Fork',
      description: `Remove the direct fork relationship and its mappings. Requires admin on the acting workspace. Existing workflow and resource content remains available. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2UnlinkWorkspaceForkContract.params,
        'UnlinkWorkspaceForkParams',
        'UnlinkWorkspaceFork params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2UnlinkWorkspaceForkContract.query,
        'UnlinkWorkspaceForkQuery',
        'UnlinkWorkspaceFork query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2UnlinkWorkspaceForkContract.body,
        'UnlinkWorkspaceForkBody',
        'UnlinkWorkspaceFork body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2UnlinkWorkspaceForkContract.response.schema,
        'UnlinkWorkspaceForkResponse',
        'UnlinkWorkspaceFork response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkspaceForkExclusionsContract,
    {
      applicationOperation: forkOperations.exclusions,
      operationId: 'updateWorkspaceForkExclusions',
      summary: 'Update Workspace Fork Exclusions',
      description: `Include or exclude selected workflows from fork sync. Excluded workflows are skipped as sources and targets. Missing, archived, and unchanged workflow IDs are skipped. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The workspace operation result.' },
    },
    {
      params: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.params,
        'UpdateWorkspaceForkExclusionsParams',
        'UpdateWorkspaceForkExclusions params',
        'The params for this operation.'
      ),
      query: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.query,
        'UpdateWorkspaceForkExclusionsQuery',
        'UpdateWorkspaceForkExclusions query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.body,
        'UpdateWorkspaceForkExclusionsBody',
        'UpdateWorkspaceForkExclusions body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2UpdateWorkspaceForkExclusionsContract.response.schema,
        'UpdateWorkspaceForkExclusionsResponse',
        'UpdateWorkspaceForkExclusions response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewWorkflowImportContract,
    {
      applicationOperation: workflowOperations.importPreview,
      operationId: 'previewWorkflowImport',
      summary: 'Preview Workflow Import',
      description: `Validate destination mappings and dependent choices without creating a workflow. Returns unresolved fields, discovery instructions, and a fingerprint required by mapped import. No source workspace is queried from imported provenance.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2PreviewWorkflowImportContract.query,
        'PreviewWorkflowImportQuery',
        'PreviewWorkflowImport query',
        'The query for this operation.'
      ),
      body: v2PreviewWorkflowImportContract.body,
      response: documentedSchema(
        v2PreviewWorkflowImportContract.response.schema,
        'PreviewWorkflowImportResponse',
        'PreviewWorkflowImport response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'listSelector',
      summary: 'List Selector Options',
      description: `List workspace-scoped configuration choices using the selector key and dependencies from an import or sync preview. Missing OAuth connections require human authorization before provider choices can be discovered. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2ListSelectorContract.query,
        'ListSelectorQuery',
        'ListSelector query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2ListSelectorContract.body,
        'ListSelectorBody',
        'ListSelector body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2ListSelectorContract.response.schema,
        'ListSelectorResponse',
        'ListSelector response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetSelectorContract,
    {
      applicationOperation: selectorOperations.execute,
      operationId: 'getSelector',
      summary: 'Get Selector Option',
      description: `Resolve a workspace configuration option by its provider identifier and declared dependencies. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2GetSelectorContract.query,
        'GetSelectorQuery',
        'GetSelector query',
        'The query for this operation.'
      ),
      body: documentedSchema(
        v2GetSelectorContract.body,
        'GetSelectorBody',
        'GetSelector body',
        'The body for this operation.'
      ),
      response: documentedSchema(
        v2GetSelectorContract.response.schema,
        'GetSelectorResponse',
        'GetSelector response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetWorkspaceOperationContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'getWorkspaceOperation',
      summary: 'Get Workspace Operation',
      description: `Read a committed operation, copy progress, exact deployment readiness, and structured issues. A failed follow-up does not mean the business transaction was rolled back.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2GetWorkspaceOperationContract.query,
        'GetWorkspaceOperationQuery',
        'GetWorkspaceOperation query',
        'The query for this operation.'
      ),
      params: documentedSchema(
        v2GetWorkspaceOperationContract.params,
        'GetWorkspaceOperationParams',
        'GetWorkspaceOperation params',
        'The params for this operation.'
      ),
      response: documentedSchema(
        v2GetWorkspaceOperationContract.response.schema,
        'GetWorkspaceOperationResponse',
        'GetWorkspaceOperation response',
        'The response for this operation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkspaceOperationsContract,
    {
      applicationOperation: workspaceOperations.read,
      operationId: 'listWorkspaceOperations',
      summary: 'List Workspace Operations',
      description: `Page committed operations newest first. Filter by the original request ID to reconcile an uncertain mutation response.`,
      tags: ['Workspace Sync'],
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The operation result.' },
    },
    {
      query: documentedSchema(
        v2ListWorkspaceOperationsContract.query,
        'ListWorkspaceOperationsQuery',
        'ListWorkspaceOperations query',
        'The query for this operation.'
      ),
      params: documentedSchema(
        v2ListWorkspaceOperationsContract.params,
        'ListWorkspaceOperationsParams',
        'ListWorkspaceOperations params',
        'The params for this operation.'
      ),
      response: documentedSchema(
        v2ListWorkspaceOperationsContract.response.schema,
        'ListWorkspaceOperationsResponse',
        'ListWorkspaceOperations response',
        'The response for this operation.'
      ),
    }
  ),
]
