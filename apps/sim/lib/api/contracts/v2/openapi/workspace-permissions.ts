import {
  documentedSchema,
  RATE_LIMIT_HEADERS,
  RESOURCE_ERRORS,
  WORKSPACE_API_KEY_DENIED,
} from '@/lib/api/contracts/v2/openapi/shared'
import { v2GetWorkspacePermissionConfigContract } from '@/lib/api/contracts/v2/workspace-permissions'
import { defineOpenApiRoute } from '@/lib/api/openapi/types'
import { permissionGroupWorkspaceOperations } from '@/lib/permission-groups/application/operations'

export const workspacePermissionOpenApiRoutes = [
  defineOpenApiRoute(
    v2GetWorkspacePermissionConfigContract,
    {
      applicationOperation: permissionGroupWorkspaceOperations.readUserConfig,
      operationId: 'getWorkspacePermissionConfig',
      summary: 'Get Workspace Permission Config',
      description: `Get the acting user's governing permission group and configuration for a workspace they can access. This describes permission-group restrictions, not the user's workspace role. Group and config are null when no group governs the caller; entitled indicates whether organization permission governance is active. ${WORKSPACE_API_KEY_DENIED}`,
      tags: ['Workspaces'],
      errors: RESOURCE_ERRORS,
      success: {
        description: 'The caller’s effective permission-group configuration.',
        headers: RATE_LIMIT_HEADERS,
      },
    },
    {
      params: documentedSchema(
        v2GetWorkspacePermissionConfigContract.params,
        'GetWorkspacePermissionConfigParams',
        'Get Workspace Permission Config parameters',
        'Target workspace.'
      ),
      query: v2GetWorkspacePermissionConfigContract.query,
      response: documentedSchema(
        v2GetWorkspacePermissionConfigContract.response.schema,
        'GetWorkspacePermissionConfigResponse',
        'Get Workspace Permission Config response',
        'Configuration for the acting caller only.',
        [
          {
            data: {
              permissionGroupId: null,
              groupName: null,
              config: null,
              entitled: false,
              organizationId: null,
              isOrgAdmin: false,
            },
          },
        ]
      ),
    }
  ),
] as const
