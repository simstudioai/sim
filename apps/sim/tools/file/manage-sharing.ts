import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import type { ToolConfig, ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

interface FileManageSharingParams {
  fileId: string
  isActive?: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  workspaceId?: string
  _context?: WorkflowToolExecutionContext
}

export const fileManageSharingTool: ToolConfig<FileManageSharingParams, ToolResponse> = {
  id: 'file_manage_sharing',
  name: 'Manage Sharing',
  description:
    'Enable or disable the public share link for a workspace file, and set its access mode (public, password, email, or SSO). Idempotent: the public link stays stable across changes.',
  version: '1.0.0',

  params: {
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the workspace file to update sharing for.',
    },
    isActive: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the public link is enabled. Set to false to make the file private.',
    },
    authType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Access mode for the link: "public", "password", "email", or "sso". Defaults to "public".',
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
      description:
        'Allowed emails or "@domain" patterns. Required when authType is "email" or "sso".',
    },
  },

  request: {
    url: '/api/tools/file/manage',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'manage_sharing',
      fileId: params.fileId,
      isActive: params.isActive,
      authType: params.authType,
      password: params.password,
      allowedEmails: params.allowedEmails,
      workspaceId: params.workspaceId || params._context?.workspaceId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok || !data.success) {
      return { success: false, output: {}, error: data.error || 'Failed to update file sharing' }
    }
    return { success: true, output: data.data.share }
  },

  outputs: {
    url: { type: 'string', description: 'Public share URL for the file' },
    isActive: { type: 'boolean', description: 'Whether the public link is enabled' },
    authType: { type: 'string', description: 'Access mode: public, password, email, or sso' },
    hasPassword: { type: 'boolean', description: 'Whether the share is password-protected' },
    allowedEmails: {
      type: 'array',
      description: 'Allowed emails/domains for email or SSO access',
    },
  },
}
