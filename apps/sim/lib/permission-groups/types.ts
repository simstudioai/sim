import { z } from 'zod'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'

/** Auth modes a public file share can use; admins may restrict the allowed subset. */
export const FILE_SHARE_AUTH_TYPES = ['public', 'password', 'email', 'sso'] as const

export const PERMISSION_GROUP_CONSTRAINTS = {
  organizationName: 'permission_group_organization_name_unique',
  organizationDefault: 'permission_group_organization_default_unique',
} as const

export const PERMISSION_GROUP_MEMBER_CONSTRAINTS = {
  groupUser: 'permission_group_member_group_user_unique',
} as const

export const PERMISSION_GROUP_WORKSPACE_CONSTRAINTS = {
  groupWorkspace: 'permission_group_workspace_group_workspace_unique',
} as const

export const permissionGroupConfigSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable().optional(),
  allowedModelProviders: z.array(z.string()).nullable().optional(),
  deniedModels: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  hideTraceSpans: z.boolean().optional(),
  hideKnowledgeBaseTab: z.boolean().optional(),
  hideTablesTab: z.boolean().optional(),
  hideCopilot: z.boolean().optional(),
  hideIntegrationsTab: z.boolean().optional(),
  hideSecretsTab: z.boolean().optional(),
  hideApiKeysTab: z.boolean().optional(),
  hideInboxTab: z.boolean().optional(),
  hideFilesTab: z.boolean().optional(),
  disableMcpTools: z.boolean().optional(),
  disableCustomTools: z.boolean().optional(),
  disableSkills: z.boolean().optional(),
  disableInvitations: z.boolean().optional(),
  disablePublicApi: z.boolean().optional(),
  disablePublicFileSharing: z.boolean().optional(),
  allowedFileShareAuthTypes: z.array(z.enum(FILE_SHARE_AUTH_TYPES)).nullable().optional(),
  hideDeployApi: z.boolean().optional(),
  hideDeployMcp: z.boolean().optional(),
  hideDeployChatbot: z.boolean().optional(),
  hideDeployTemplate: z.boolean().optional(),
})

export interface PermissionGroupConfig {
  allowedIntegrations: string[] | null
  allowedModelProviders: string[] | null
  /**
   * Fully-qualified model IDs (e.g. `ollama/llama3`, `gpt-4o`) blocked for this
   * group, checked after `allowedModelProviders`. Empty means nothing is blocked.
   */
  deniedModels: string[]
  /**
   * Snake_case tool IDs (e.g. `slack_canvas`) blocked for this group, checked
   * after the block-level `allowedIntegrations` gate. Lets an admin allow an
   * integration but deny specific operations within it. Empty means nothing is
   * blocked.
   */
  deniedTools: string[]
  hideTraceSpans: boolean
  hideKnowledgeBaseTab: boolean
  hideTablesTab: boolean
  hideCopilot: boolean
  hideIntegrationsTab: boolean
  hideSecretsTab: boolean
  hideApiKeysTab: boolean
  hideInboxTab: boolean
  hideFilesTab: boolean
  disableMcpTools: boolean
  disableCustomTools: boolean
  disableSkills: boolean
  disableInvitations: boolean
  disablePublicApi: boolean
  disablePublicFileSharing: boolean
  /** Allowed public-file-share auth modes; `null` means all are allowed. */
  allowedFileShareAuthTypes: ShareAuthType[] | null
  hideDeployApi: boolean
  hideDeployMcp: boolean
  hideDeployChatbot: boolean
  hideDeployTemplate: boolean
}

export const DEFAULT_PERMISSION_GROUP_CONFIG: PermissionGroupConfig = {
  allowedIntegrations: null,
  allowedModelProviders: null,
  deniedModels: [],
  deniedTools: [],
  hideTraceSpans: false,
  hideKnowledgeBaseTab: false,
  hideTablesTab: false,
  hideCopilot: false,
  hideIntegrationsTab: false,
  hideSecretsTab: false,
  hideApiKeysTab: false,
  hideInboxTab: false,
  hideFilesTab: false,
  disableMcpTools: false,
  disableCustomTools: false,
  disableSkills: false,
  disableInvitations: false,
  disablePublicApi: false,
  disablePublicFileSharing: false,
  allowedFileShareAuthTypes: null,
  hideDeployApi: false,
  hideDeployMcp: false,
  hideDeployChatbot: false,
  hideDeployTemplate: false,
}

export function parsePermissionGroupConfig(config: unknown): PermissionGroupConfig {
  if (!config || typeof config !== 'object') {
    return DEFAULT_PERMISSION_GROUP_CONFIG
  }

  const c = config as Record<string, unknown>

  return {
    allowedIntegrations: Array.isArray(c.allowedIntegrations) ? c.allowedIntegrations : null,
    allowedModelProviders: Array.isArray(c.allowedModelProviders) ? c.allowedModelProviders : null,
    deniedModels: Array.isArray(c.deniedModels)
      ? c.deniedModels.filter((m): m is string => typeof m === 'string')
      : [],
    deniedTools: Array.isArray(c.deniedTools)
      ? c.deniedTools.filter((t): t is string => typeof t === 'string')
      : [],
    hideTraceSpans: typeof c.hideTraceSpans === 'boolean' ? c.hideTraceSpans : false,
    hideKnowledgeBaseTab:
      typeof c.hideKnowledgeBaseTab === 'boolean' ? c.hideKnowledgeBaseTab : false,
    hideTablesTab: typeof c.hideTablesTab === 'boolean' ? c.hideTablesTab : false,
    hideCopilot: typeof c.hideCopilot === 'boolean' ? c.hideCopilot : false,
    hideIntegrationsTab: typeof c.hideIntegrationsTab === 'boolean' ? c.hideIntegrationsTab : false,
    hideSecretsTab: typeof c.hideSecretsTab === 'boolean' ? c.hideSecretsTab : false,
    hideApiKeysTab: typeof c.hideApiKeysTab === 'boolean' ? c.hideApiKeysTab : false,
    hideInboxTab: typeof c.hideInboxTab === 'boolean' ? c.hideInboxTab : false,
    hideFilesTab: typeof c.hideFilesTab === 'boolean' ? c.hideFilesTab : false,
    disableMcpTools: typeof c.disableMcpTools === 'boolean' ? c.disableMcpTools : false,
    disableCustomTools: typeof c.disableCustomTools === 'boolean' ? c.disableCustomTools : false,
    disableSkills: typeof c.disableSkills === 'boolean' ? c.disableSkills : false,
    disableInvitations: typeof c.disableInvitations === 'boolean' ? c.disableInvitations : false,
    disablePublicApi: typeof c.disablePublicApi === 'boolean' ? c.disablePublicApi : false,
    disablePublicFileSharing:
      typeof c.disablePublicFileSharing === 'boolean' ? c.disablePublicFileSharing : false,
    allowedFileShareAuthTypes: Array.isArray(c.allowedFileShareAuthTypes)
      ? c.allowedFileShareAuthTypes.filter((t): t is ShareAuthType =>
          (FILE_SHARE_AUTH_TYPES as readonly string[]).includes(t as string)
        )
      : null,
    hideDeployApi: typeof c.hideDeployApi === 'boolean' ? c.hideDeployApi : false,
    hideDeployMcp: typeof c.hideDeployMcp === 'boolean' ? c.hideDeployMcp : false,
    hideDeployChatbot: typeof c.hideDeployChatbot === 'boolean' ? c.hideDeployChatbot : false,
    hideDeployTemplate: typeof c.hideDeployTemplate === 'boolean' ? c.hideDeployTemplate : false,
  }
}
