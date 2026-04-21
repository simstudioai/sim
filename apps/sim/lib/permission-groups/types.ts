import { z } from 'zod'

export const PERMISSION_GROUP_MEMBER_CONSTRAINTS = {
  groupUser: 'permission_group_member_group_user_unique',
  workspaceUser: 'permission_group_member_workspace_user_unique',
} as const

export const permissionGroupConfigSchema = z.object({
  allowedIntegrations: z.array(z.string()).nullable().optional(),
  allowedModelProviders: z.array(z.string()).nullable().optional(),
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
  hideDeployApi: z.boolean().optional(),
  hideDeployMcp: z.boolean().optional(),
  hideDeployA2a: z.boolean().optional(),
  hideDeployChatbot: z.boolean().optional(),
  hideDeployTemplate: z.boolean().optional(),
})

export interface PermissionGroupConfig {
  allowedIntegrations: string[] | null
  allowedModelProviders: string[] | null
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
  hideDeployApi: boolean
  hideDeployMcp: boolean
  hideDeployA2a: boolean
  hideDeployChatbot: boolean
  hideDeployTemplate: boolean
}

export const DEFAULT_PERMISSION_GROUP_CONFIG: PermissionGroupConfig = {
  allowedIntegrations: null,
  allowedModelProviders: null,
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
  hideDeployApi: false,
  hideDeployMcp: false,
  hideDeployA2a: false,
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
    hideDeployApi: typeof c.hideDeployApi === 'boolean' ? c.hideDeployApi : false,
    hideDeployMcp: typeof c.hideDeployMcp === 'boolean' ? c.hideDeployMcp : false,
    hideDeployA2a: typeof c.hideDeployA2a === 'boolean' ? c.hideDeployA2a : false,
    hideDeployChatbot: typeof c.hideDeployChatbot === 'boolean' ? c.hideDeployChatbot : false,
    hideDeployTemplate: typeof c.hideDeployTemplate === 'boolean' ? c.hideDeployTemplate : false,
  }
}
