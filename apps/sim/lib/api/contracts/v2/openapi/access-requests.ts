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
      summary: 'Discover workspace access requests',
      description: `Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of access targets and the acting user’s current access state.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.params,
        'DiscoverWorkspaceAccessRequestsParams',
        'Discover workspace access requests parameters',
        'Workspace identifier.'
      ),
      query: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.query,
        'DiscoverWorkspaceAccessRequestsQuery',
        'Discover workspace access requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2DiscoverWorkspaceAccessRequestsContract.response.schema,
        'DiscoverWorkspaceAccessRequestsResponse',
        'Discover workspace access requests response',
        'A page of access targets and the acting user’s current access state.',
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
      summary: 'List my workspace access requests',
      description: `List only the acting user’s requests in this workspace, including resolved history and organization-wide member credit-limit requests. History remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of the acting user’s workspace and member-credit requests.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.params,
        'ListMyWorkspaceAccessRequestsParams',
        'List my workspace access requests parameters',
        'Workspace identifier.'
      ),
      query: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.query,
        'ListMyWorkspaceAccessRequestsQuery',
        'List my workspace access requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListMyWorkspaceAccessRequestsContract.response.schema,
        'ListMyWorkspaceAccessRequestsResponse',
        'List my workspace access requests response',
        'A page of the acting user’s workspace and member-credit requests.',
        [{ data: [requestExample], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateWorkspaceAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.create,
      operationId: 'createWorkspaceAccessRequest',
      summary: 'Create workspace access request',
      description: `Request access using a target from Discover workspace access requests. Requires access to an organization-owned workspace with requests enabled; external collaborators use their workspace grant. Each requester can have 100 pending requests and submit 100 in 24 hours within the organization. Matching pending requests are reused; an existing request may be closed if access is already available. Permission approvals change the governing group for all affected members. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description:
          'The new request, matching pending request, or existing request closed because access became available.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.params,
        'CreateWorkspaceAccessRequestParams',
        'Create workspace access request parameters',
        'Workspace identifier.'
      ),
      query: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.query,
        'CreateWorkspaceAccessRequestQuery',
        'Create workspace access request query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.body,
        'CreateWorkspaceAccessRequestBody',
        'Create workspace access request body',
        'A discovered access target and an optional reason for the request.',
        [{ target: requestExample.target, reason: 'Maintain team data' }]
      ),
      response: documentedSchema(
        v2CreateWorkspaceAccessRequestContract.response.schema,
        'CreateWorkspaceAccessRequestResponse',
        'Create workspace access request response',
        'The new request, matching pending request, or existing request closed because access became available.',
        [{ data: requestExample }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelWorkspaceAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.cancel,
      operationId: 'cancelWorkspaceAccessRequest',
      summary: 'Cancel workspace access request',
      description: `Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires access to the workspace; external collaborators use their workspace grant. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The cancelled request, or the unchanged request if already resolved.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.params,
        'CancelWorkspaceAccessRequestParams',
        'Cancel workspace access request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.query,
        'CancelWorkspaceAccessRequestQuery',
        'Cancel workspace access request query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2CancelWorkspaceAccessRequestContract.response.schema,
        'CancelWorkspaceAccessRequestResponse',
        'Cancel workspace access request response',
        'The cancelled request, or the unchanged request if already resolved.',
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
      summary: 'Discover organization access requests',
      description: `Discover the acting user’s access to features, integrations, models, tools, authentication methods, and member credit limits. Returns an empty list while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of access targets and the acting user’s current access state.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.params,
        'DiscoverOrganizationAccessRequestsParams',
        'Discover organization access requests parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.query,
        'DiscoverOrganizationAccessRequestsQuery',
        'Discover organization access requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2DiscoverOrganizationAccessRequestsContract.response.schema,
        'DiscoverOrganizationAccessRequestsResponse',
        'Discover organization access requests response',
        'A page of access targets and the acting user’s current access state.',
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
      summary: 'List my organization access requests',
      description: `List the acting user’s organization-level requests and member credit-limit requests, including resolved history. For workspace-scoped requests, use List my workspace access requests. History remains available while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of the acting user’s organization and member-credit requests.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.params,
        'ListMyOrganizationAccessRequestsParams',
        'List my organization access requests parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.query,
        'ListMyOrganizationAccessRequestsQuery',
        'List my organization access requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListMyOrganizationAccessRequestsContract.response.schema,
        'ListMyOrganizationAccessRequestsResponse',
        'List my organization access requests response',
        'A page of the acting user’s organization and member-credit requests.',
        [{ data: [{ ...requestExample, workspaceId: null }], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.create,
      operationId: 'createOrganizationAccessRequest',
      summary: 'Create organization access request',
      description: `Request access using a target from Discover organization access requests. Requires organization membership and requests enabled. Each requester can have 100 pending requests and submit 100 in 24 hours within the organization. Matching pending requests are reused; an existing request may be closed if access is already available. Permission approvals change the governing group for all affected members. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description:
          'The new request, matching pending request, or existing request closed because access became available.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CreateOrganizationAccessRequestContract.params,
        'CreateOrganizationAccessRequestParams',
        'Create organization access request parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2CreateOrganizationAccessRequestContract.query,
        'CreateOrganizationAccessRequestQuery',
        'Create organization access request query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2CreateOrganizationAccessRequestContract.body,
        'CreateOrganizationAccessRequestBody',
        'Create organization access request body',
        'A discovered access target and an optional reason for the request.',
        [{ target: requestExample.target, reason: 'Maintain team data' }]
      ),
      response: documentedSchema(
        v2CreateOrganizationAccessRequestContract.response.schema,
        'CreateOrganizationAccessRequestResponse',
        'Create organization access request response',
        'The new request, matching pending request, or existing request closed because access became available.',
        [{ data: { ...requestExample, workspaceId: null } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.cancel,
      operationId: 'cancelOrganizationAccessRequest',
      summary: 'Cancel organization access request',
      description: `Cancel the acting user’s pending request in this scope, including an organization-wide member credit-limit request. Already resolved requests are returned unchanged. Cancellation remains available while requests are disabled. Requires organization membership. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The cancelled request, or the unchanged request if already resolved.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2CancelOrganizationAccessRequestContract.params,
        'CancelOrganizationAccessRequestParams',
        'Cancel organization access request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2CancelOrganizationAccessRequestContract.query,
        'CancelOrganizationAccessRequestQuery',
        'Cancel organization access request query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2CancelOrganizationAccessRequestContract.response.schema,
        'CancelOrganizationAccessRequestResponse',
        'Cancel organization access request response',
        'The cancelled request, or the unchanged request if already resolved.',
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
      summary: 'List organization access requests',
      description: `List requests across the organization for administrator review. Includes requests from organization members and external workspace collaborators; history remains available while requests are disabled. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'A page of requests across the organization for Admin review.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ListOrganizationAccessRequestsContract.params,
        'ListOrganizationAccessRequestsParams',
        'List organization access requests parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2ListOrganizationAccessRequestsContract.query,
        'ListOrganizationAccessRequestsQuery',
        'List organization access requests query',
        'Query parameters for this operation.'
      ),
      response: documentedSchema(
        v2ListOrganizationAccessRequestsContract.response.schema,
        'ListOrganizationAccessRequestsResponse',
        'List organization access requests response',
        'A page of requests across the organization for Admin review.',
        [{ data: [requestExample], nextCursor: null }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2PreviewOrganizationAccessRequestContract,
    {
      applicationOperation: accessRequestOperations.preview,
      operationId: 'previewOrganizationAccessRequest',
      summary: 'Preview organization access request',
      description: `Preview the current permission changes, affected group and audience, or member credit cap. Review \`canApply\`, \`changes\`, \`impact\`, and \`fingerprint\` before resolving. Permission changes affect the entire governing group, not only the requester. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The proposed group or credit-cap change, affected audience, and fingerprint.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.params,
        'PreviewOrganizationAccessRequestParams',
        'Preview organization access request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.query,
        'PreviewOrganizationAccessRequestQuery',
        'Preview organization access request query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2PreviewOrganizationAccessRequestContract.response.schema,
        'PreviewOrganizationAccessRequestResponse',
        'Preview organization access request response',
        'The proposed group or credit-cap change, affected audience, and fingerprint.',
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
      summary: 'Resolve organization access request',
      description: `Apply a reviewed request or decline it with a reason. Applying requires the preview fingerprint; changed policy or membership returns a conflict. Credit requests also require a higher \`newLimitCredits\`. Already resolved requests are returned unchanged. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The applied or declined request, or its unchanged resolved state.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.params,
        'ResolveOrganizationAccessRequestParams',
        'Resolve organization access request parameters',
        'Scope and request identifiers.'
      ),
      query: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.query,
        'ResolveOrganizationAccessRequestQuery',
        'Resolve organization access request query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.body,
        'ResolveOrganizationAccessRequestBody',
        'Resolve organization access request body',
        'Apply the reviewed fingerprint, with a higher credit cap when applicable, or decline with a reason.',
        [{ action: 'apply', expectedFingerprint: 'current-preview-fingerprint' }]
      ),
      response: documentedSchema(
        v2ResolveOrganizationAccessRequestContract.response.schema,
        'ResolveOrganizationAccessRequestResponse',
        'Resolve organization access request response',
        'The applied or declined request, or its unchanged resolved state.',
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
      summary: 'Get organization access request settings',
      description: `Get whether the organization allows new access requests and approvals. This preference does not enable features unavailable in the deployment or subscription. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'Whether new requests and approvals are allowed.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.params,
        'GetOrganizationAccessRequestSettingsParams',
        'Get organization access request settings parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.query,
        'GetOrganizationAccessRequestSettingsQuery',
        'Get organization access request settings query',
        'No query parameters.'
      ),
      response: documentedSchema(
        v2GetOrganizationAccessRequestSettingsContract.response.schema,
        'GetOrganizationAccessRequestSettingsResponse',
        'Get organization access request settings response',
        'Whether new requests and approvals are allowed.',
        [{ data: { allowRequests: true } }]
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateOrganizationAccessRequestSettingsContract,
    {
      applicationOperation: accessRequestOperations.updateSettings,
      operationId: 'updateOrganizationAccessRequestSettings',
      summary: 'Update organization access request settings',
      description: `Allow or pause new access requests and approvals. Pausing preserves history, cancellation, and decline, and does not revoke previously granted access. Requires organization Admin access. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Access Requests'],
      errors: RESOURCE_CONFLICT_ERRORS,
      success: {
        description: 'The saved setting for new requests and approvals.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.params,
        'UpdateOrganizationAccessRequestSettingsParams',
        'Update organization access request settings parameters',
        'Organization identifier.'
      ),
      query: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.query,
        'UpdateOrganizationAccessRequestSettingsQuery',
        'Update organization access request settings query',
        'No query parameters.'
      ),
      body: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.body,
        'UpdateOrganizationAccessRequestSettingsBody',
        'Update organization access request settings body',
        'Whether new requests and approvals are allowed.',
        [{ allowRequests: false }]
      ),
      response: documentedSchema(
        v2UpdateOrganizationAccessRequestSettingsContract.response.schema,
        'UpdateOrganizationAccessRequestSettingsResponse',
        'Update organization access request settings response',
        'The saved setting for new requests and approvals.',
        [{ data: { allowRequests: false } }]
      ),
    }
  ),
]
