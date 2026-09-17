import type {
  CodaListWorkspaceRolesResponse,
  CodaWorkspaceParams,
  CodaWorkspaceRoleActivity,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  WORKSPACE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListWorkspaceRolesTool: ToolConfig<
  CodaWorkspaceParams,
  CodaListWorkspaceRolesResponse
> = {
  id: 'coda_list_workspace_roles',
  name: 'Coda List Workspace Role Activity',
  description:
    'Get monthly counts of active and inactive Admins, Doc Makers, and Editors in a workspace. The workspace must belong to an organization.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, workspaceId: WORKSPACE_ID_PARAM },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('workspaces', [params.workspaceId, 'workspaceId'], 'roles')),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: CodaWorkspaceRoleActivity[] }
    return {
      success: true,
      output: {
        roleActivity: (data.items ?? []).map((item) => ({
          month: item.month,
          activeAdminCount: item.activeAdminCount,
          activeDocMakerCount: item.activeDocMakerCount,
          activeEditorCount: item.activeEditorCount,
          inactiveAdminCount: item.inactiveAdminCount,
          inactiveDocMakerCount: item.inactiveDocMakerCount,
          inactiveEditorCount: item.inactiveEditorCount,
        })),
      },
    }
  },

  outputs: {
    roleActivity: {
      type: 'array',
      description: 'Role counts per month',
      items: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Month of the data (YYYY-MM-DD)' },
          activeAdminCount: { type: 'number', description: 'Active Admins' },
          activeDocMakerCount: { type: 'number', description: 'Active Doc Makers' },
          activeEditorCount: { type: 'number', description: 'Active Editors' },
          inactiveAdminCount: { type: 'number', description: 'Inactive Admins' },
          inactiveDocMakerCount: { type: 'number', description: 'Inactive Doc Makers' },
          inactiveEditorCount: { type: 'number', description: 'Inactive Editors' },
        },
      },
    },
  },
}
