import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

interface FileManageFolderSharingParams {
  path: string
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  workspaceId?: string
}

export const fileManageFolderSharingTool: InternalToolConfig<
  FileManageFolderSharingParams,
  ToolResponse
> = {
  id: 'file_manage_folder_sharing',
  name: 'Manage Folder Sharing',
  description:
    'Enable or disable the public share link for a workspace file folder and its current descendants. Set public, password, email, or SSO access. The link stays stable across changes.',
  version: '1.0.0',
  params: {
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Canonical percent-encoded folder path, e.g. "/Reports/Q3%20Results". The workspace root cannot be shared.',
    },
    isActive: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the public folder link is enabled. Set false to disable access.',
    },
    authType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Access mode: "public", "password", "email", or "sso". Defaults to "public".',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password to protect the link. Required when authType is "password".',
    },
    allowedEmails: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allowed emails or "@domain" patterns for email or SSO access.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'manage_folder_sharing',
      path: params.path,
      isActive: params.isActive,
      authType: params.authType,
      password: params.password,
      allowedEmails: params.allowedEmails,
      workspaceId: params.workspaceId,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to update folder sharing' }
    }
    return { success: true, output: data.data.share }
  },
  outputs: {
    url: { type: 'string', description: 'Public folder URL; empty when the link is disabled' },
    isActive: { type: 'boolean', description: 'Whether the public folder link is enabled' },
    authType: { type: 'string', description: 'Access mode: public, password, email, or sso' },
    hasPassword: { type: 'boolean', description: 'Whether the link is password-protected' },
    allowedEmails: { type: 'array', description: 'Allowed emails/domains for email or SSO access' },
  },
}
