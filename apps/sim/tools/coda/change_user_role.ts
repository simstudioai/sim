import type { CodaChangeUserRoleParams, CodaChangeUserRoleResponse } from '@/tools/coda/types'
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

export const codaChangeUserRoleTool: ToolConfig<
  CodaChangeUserRoleParams,
  CodaChangeUserRoleResponse
> = {
  id: 'coda_change_user_role',
  name: 'Coda Change User Role',
  description:
    'Change the workspace role of a Coda user. Requires Admin access in a workspace that belongs to an organization.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    workspaceId: WORKSPACE_ID_PARAM,
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the workspace member',
    },
    newRole: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New role: "Admin", "DocMaker", or "Editor"',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('workspaces', [params.workspaceId, 'workspaceId'], 'users', 'role')),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => ({ email: String(params.email ?? '').trim(), newRole: params.newRole }),
  },

  transformResponse: async (response, params) => {
    const data = (await response.json()) as { roleChangedAt: string }
    return {
      success: true,
      output: {
        email: String(params?.email ?? '').trim(),
        newRole: params?.newRole ?? '',
        roleChangedAt: data.roleChangedAt,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'Email address of the member' },
    newRole: { type: 'string', description: 'Role assigned' },
    roleChangedAt: { type: 'string', description: 'When the role change took effect' },
  },
}
