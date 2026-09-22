import {
  v2CancelOrganizationAccessRequestContract,
  v2CancelWorkspaceAccessRequestContract,
  v2CreateOrganizationAccessRequestContract,
  v2CreateWorkspaceAccessRequestContract,
  v2DiscoverOrganizationAccessRequestsContract,
  v2DiscoverWorkspaceAccessRequestsContract,
  v2GetOrganizationAccessRequestSettingsContract,
  v2ListMyOrganizationAccessRequestsContract,
  v2ListMyWorkspaceAccessRequestsContract,
  v2ListOrganizationAccessRequestsContract,
  v2PreviewOrganizationAccessRequestContract,
  v2ResolveOrganizationAccessRequestContract,
  v2UpdateOrganizationAccessRequestSettingsContract,
} from '@/lib/api/contracts/v2/access-requests'
import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'

const requestExample = {
  id: 'request-123',
  organizationId: 'org-123',
  workspaceId: 'workspace-123',
  target: { kind: 'feature', configKey: 'hideTablesTab' },
  targetLabel: 'Tables',
  reason: 'Maintain team data',
  status: 'pending',
  decisionReason: null,
  createdAt: '2026-06-01T09:00:00.000Z',
  decidedAt: null,
  groupName: 'Engineering',
  requester: { id: 'user-123', name: 'Alex Example', email: 'alex@example.com' },
} as const

export const accessRequestOpenApiRoutes = [
  defineOpenApiRoute(
    v2DiscoverWorkspaceAccessRequestsContract,
    {
      applicationOperation: accessRequestOperations.discover,
      operationId: 'discoverWorkspaceAccessRequests',
      summary: 'Discover Workspace Access Requests',
      description: `Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Discover Workspace Access Requests result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.params,
        'DiscoverWorkspaceAccessRequestsParams',
        'Discover Workspace Access Requests parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.query,
        'DiscoverWorkspaceAccessRequestsQuery',
        'Discover Workspace Access Requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.response.schema,
        'DiscoverWorkspaceAccessRequestsResponse',
        'Discover Workspace Access Requests response',
        'Discover Workspace Access Requests result.',
        [
          {
            data: [
              {
                target: requestExample.target,
                label: 'Tables',
                state: 'requestable',
                reason: null,
                pendingRequestId: null,
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListMyWorkspaceAccessRequestsContract,
    {
      applicationOperation: accessRequestOperations.listMine,
      operationId: 'listMyWorkspaceAccessRequests',
      summary: 'List My Workspace Access Requests',
      description: `List only the acting user’s requests in this workspace, including resolved history and organization-wide member credit-limit requests. History remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'List My Workspace Access Requests result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.params,
        'ListMyWorkspaceAccessRequestsParams',
        'List My Workspace Access Requests parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.query,
        'ListMyWorkspaceAccessRequestsQuery',
        'List My Workspace Access Requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.response.schema,
        'ListMyWorkspaceAccessRequestsResponse',
        'List My Workspace Access Requests response',
        'List My Workspace Access Requests result.',
        [{ data: [requestExample], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkspaceAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.create,
      operationId: 'createWorkspaceAccessRequest',
      summary: 'Create Workspace Access Request',
      description: `Request access for the acting user using a target from discovery. Returns an existing matching pending request when applicable; the result may be closed if access is already available. Permission approvals change the governing group for all affected members. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Create Workspace Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.params,
        'CreateWorkspaceAccessRequestParams',
        'Create Workspace Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.query,
        'CreateWorkspaceAccessRequestQuery',
        'Create Workspace Access Request query',
        'Query parameters for this operation.'
      ),
      body: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.body,
        'CreateWorkspaceAccessRequestBody',
        'Create Workspace Access Request body',
        'Inputs for this operation.',
        [{ target: requestExample.target, reason: 'Maintain team data' }]
      ),
      response: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.response.schema,
        'CreateWorkspaceAccessRequestResponse',
        'Create Workspace Access Request response',
        'Create Workspace Access Request result.',
        [{ data: requestExample }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelWorkspaceAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.cancel,
      operationId: 'cancelWorkspaceAccessRequest',
      summary: 'Cancel Workspace Access Request',
      description: `Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Cancel Workspace Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.params,
        'CancelWorkspaceAccessRequestParams',
        'Cancel Workspace Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.query,
        'CancelWorkspaceAccessRequestQuery',
        'Cancel Workspace Access Request query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.response.schema,
        'CancelWorkspaceAccessRequestResponse',
        'Cancel Workspace Access Request response',
        'Cancel Workspace Access Request result.',
        [
          {
            data: { ...requestExample, status: 'cancelled', decidedAt: '2026-06-01T10:00:00.000Z' },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2DiscoverOrganizationAccessRequestsContract,
    {
      applicationOperation: accessRequestOperations.discover,
      operationId: 'discoverOrganizationAccessRequests',
      summary: 'Discover Organization Access Requests',
      description: `Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Discover Organization Access Requests result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.params,
        'DiscoverOrganizationAccessRequestsParams',
        'Discover Organization Access Requests parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.query,
        'DiscoverOrganizationAccessRequestsQuery',
        'Discover Organization Access Requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.response.schema,
        'DiscoverOrganizationAccessRequestsResponse',
        'Discover Organization Access Requests response',
        'Discover Organization Access Requests result.',
        [
          {
            data: [
              {
                target: requestExample.target,
                label: 'Tables',
                state: 'requestable',
                reason: null,
                pendingRequestId: null,
              },
            ],
            nextCursor: null,
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListMyOrganizationAccessRequestsContract,
    {
      applicationOperation: accessRequestOperations.listMine,
      operationId: 'listMyOrganizationAccessRequests',
      summary: 'List My Organization Access Requests',
      description: `List the acting user’s organization-level requests and member credit-limit requests, including resolved history. For workspace-scoped requests, use List My Workspace Access Requests. History remains available while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'List My Organization Access Requests result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.params,
        'ListMyOrganizationAccessRequestsParams',
        'List My Organization Access Requests parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.query,
        'ListMyOrganizationAccessRequestsQuery',
        'List My Organization Access Requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.response.schema,
        'ListMyOrganizationAccessRequestsResponse',
        'List My Organization Access Requests response',
        'List My Organization Access Requests result.',
        [{ data: [{ ...requestExample, workspaceId: null }], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.create,
      operationId: 'createOrganizationAccessRequest',
      summary: 'Create Organization Access Request',
      description: `Request access for the acting user using a target from discovery. Returns an existing matching pending request when applicable; the result may be closed if access is already available. Permission approvals change the governing group for all affected members. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Create Organization Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateOrganizationAccessRequestContract.params,
        'CreateOrganizationAccessRequestParams',
        'Create Organization Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CreateOrganizationAccessRequestContract.query,
        'CreateOrganizationAccessRequestQuery',
        'Create Organization Access Request query',
        'Query parameters for this operation.'
      ),
      body: documentedSchema(
        v2CreateOrganizationAccessRequestContract.body,
        'CreateOrganizationAccessRequestBody',
        'Create Organization Access Request body',
        'Inputs for this operation.',
        [{ target: requestExample.target, reason: 'Maintain team data' }]
      ),
      response: documentedSchema(
        v2CreateOrganizationAccessRequestContract.response.schema,
        'CreateOrganizationAccessRequestResponse',
        'Create Organization Access Request response',
        'Create Organization Access Request result.',
        [{ data: { ...requestExample, workspaceId: null } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.cancel,
      operationId: 'cancelOrganizationAccessRequest',
      summary: 'Cancel Organization Access Request',
      description: `Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Cancel Organization Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CancelOrganizationAccessRequestContract.params,
        'CancelOrganizationAccessRequestParams',
        'Cancel Organization Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CancelOrganizationAccessRequestContract.query,
        'CancelOrganizationAccessRequestQuery',
        'Cancel Organization Access Request query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2CancelOrganizationAccessRequestContract.response.schema,
        'CancelOrganizationAccessRequestResponse',
        'Cancel Organization Access Request response',
        'Cancel Organization Access Request result.',
        [
          {
            data: {
              ...requestExample,
              workspaceId: null,
              status: 'cancelled',
              decidedAt: '2026-06-01T10:00:00.000Z',
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListOrganizationAccessRequestsContract,
    {
      applicationOperation: accessRequestOperations.listOrganization,
      operationId: 'listOrganizationAccessRequests',
      summary: 'List Organization Access Requests',
      description: `List requests across the organization for administrator review. Includes requests from organization members and external workspace collaborators; history remains available while requests are disabled. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'List Organization Access Requests result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationAccessRequestsContract.params,
        'ListOrganizationAccessRequestsParams',
        'List Organization Access Requests parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2ListOrganizationAccessRequestsContract.query,
        'ListOrganizationAccessRequestsQuery',
        'List Organization Access Requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListOrganizationAccessRequestsContract.response.schema,
        'ListOrganizationAccessRequestsResponse',
        'List Organization Access Requests response',
        'List Organization Access Requests result.',
        [{ data: [requestExample], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.preview,
      operationId: 'previewOrganizationAccessRequest',
      summary: 'Preview Organization Access Request',
      description: `Preview the current permission changes, affected group and audience, or member credit cap. Review canApply, changes, impact, and fingerprint before resolving. Permission changes affect the entire governing group, not only the requester. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Preview Organization Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.params,
        'PreviewOrganizationAccessRequestParams',
        'Preview Organization Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.query,
        'PreviewOrganizationAccessRequestQuery',
        'Preview Organization Access Request query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.response.schema,
        'PreviewOrganizationAccessRequestResponse',
        'Preview Organization Access Request response',
        'Preview Organization Access Request result.',
        [
          {
            data: {
              resolutionKind: 'permission',
              request: requestExample,
              group: { id: 'group-123', name: 'Engineering' },
              changes: [
                { configKey: 'hideTablesTab', label: 'Tables', before: true, after: false },
              ],
              impact: {
                memberCount: 2,
                workspaceCount: 1,
                workspaceNames: ['Engineering'],
                truncated: false,
              },
              fingerprint: 'current-preview-fingerprint',
              canApply: true,
              unavailableReason: null,
              currentLimitCredits: null,
              newLimitCredits: null,
            },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2ResolveOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.resolve,
      operationId: 'resolveOrganizationAccessRequest',
      summary: 'Resolve Organization Access Request',
      description: `Apply a reviewed request or decline it with a reason. Applying requires the preview fingerprint; changed policy or membership returns a conflict. Credit requests also require a higher newLimitCredits. Already resolved requests are returned unchanged. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Resolve Organization Access Request result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.params,
        'ResolveOrganizationAccessRequestParams',
        'Resolve Organization Access Request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.query,
        'ResolveOrganizationAccessRequestQuery',
        'Resolve Organization Access Request query',
        'Query parameters for this operation.'
      ),
      body: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.body,
        'ResolveOrganizationAccessRequestBody',
        'Resolve Organization Access Request body',
        'Inputs for this operation.',
        [{ action: 'apply', expectedFingerprint: 'current-preview-fingerprint' }]
      ),
      response: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.response.schema,
        'ResolveOrganizationAccessRequestResponse',
        'Resolve Organization Access Request response',
        'Resolve Organization Access Request result.',
        [
          {
            data: { ...requestExample, status: 'fulfilled', decidedAt: '2026-06-01T10:00:00.000Z' },
          },
        ]
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetOrganizationAccessRequestSettingsContract,
    {
      applicationOperation: accessRequestOperations.getSettings,
      operationId: 'getOrganizationAccessRequestSettings',
      summary: 'Get Organization Access Request Settings',
      description: `Get whether the organization allows new access requests and approvals. This preference does not enable features unavailable in the deployment or subscription. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Get Organization Access Request Settings result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.params,
        'GetOrganizationAccessRequestSettingsParams',
        'Get Organization Access Request Settings parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.query,
        'GetOrganizationAccessRequestSettingsQuery',
        'Get Organization Access Request Settings query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.response.schema,
        'GetOrganizationAccessRequestSettingsResponse',
        'Get Organization Access Request Settings response',
        'Get Organization Access Request Settings result.',
        [{ data: { allowRequests: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateOrganizationAccessRequestSettingsContract,
    {
      applicationOperation: accessRequestOperations.updateSettings,
      operationId: 'updateOrganizationAccessRequestSettings',
      summary: 'Update Organization Access Request Settings',
      description: `Allow or pause new access requests and approvals. Pausing preserves history, cancellation, and decline, and does not revoke previously granted access. Requires organization administrator access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Update Organization Access Request Settings result.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.params,
        'UpdateOrganizationAccessRequestSettingsParams',
        'Update Organization Access Request Settings parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.query,
        'UpdateOrganizationAccessRequestSettingsQuery',
        'Update Organization Access Request Settings query',
        'Query parameters for this operation.'
      ),
      body: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.body,
        'UpdateOrganizationAccessRequestSettingsBody',
        'Update Organization Access Request Settings body',
        'Inputs for this operation.',
        [{ allowRequests: false }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.response.schema,
        'UpdateOrganizationAccessRequestSettingsResponse',
        'Update Organization Access Request Settings response',
        'Update Organization Access Request Settings result.',
        [{ data: { allowRequests: false } }]
      ),
    }
  ),
]
