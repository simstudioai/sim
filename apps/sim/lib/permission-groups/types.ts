export interface PermissionGroupConfig {
  allowedIntegrations: string[] | null
  allowedModelProviders: string[] | null
  // Platform Configuration
  hideTraceSpans: boolean
  hideKnowledgeBaseTab: boolean
  hideCopilot: boolean
  hideApiKeysTab: boolean
  hideEnvironmentTab: boolean
  hideFilesTab: boolean
  disableMcpTools: boolean
  disableCustomTools: boolean
  disableSkills: boolean
  hideTemplates: boolean
  disableInvitations: boolean
  // Deploy Modal Tabs
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
  hideCopilot: false,
  hideApiKeysTab: false,
  hideEnvironmentTab: false,
  hideFilesTab: false,
  disableMcpTools: false,
  disableCustomTools: false,
  disableSkills: false,
  hideTemplates: false,
  disableInvitations: false,
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
    hideCopilot: typeof c.hideCopilot === 'boolean' ? c.hideCopilot : false,
    hideApiKeysTab: typeof c.hideApiKeysTab === 'boolean' ? c.hideApiKeysTab : false,
    hideEnvironmentTab: typeof c.hideEnvironmentTab === 'boolean' ? c.hideEnvironmentTab : false,
    hideFilesTab: typeof c.hideFilesTab === 'boolean' ? c.hideFilesTab : false,
    disableMcpTools: typeof c.disableMcpTools === 'boolean' ? c.disableMcpTools : false,
    disableCustomTools: typeof c.disableCustomTools === 'boolean' ? c.disableCustomTools : false,
    disableSkills: typeof c.disableSkills === 'boolean' ? c.disableSkills : false,
    hideTemplates: typeof c.hideTemplates === 'boolean' ? c.hideTemplates : false,
    disableInvitations: typeof c.disableInvitations === 'boolean' ? c.disableInvitations : false,
    hideDeployApi: typeof c.hideDeployApi === 'boolean' ? c.hideDeployApi : false,
    hideDeployMcp: typeof c.hideDeployMcp === 'boolean' ? c.hideDeployMcp : false,
    hideDeployA2a: typeof c.hideDeployA2a === 'boolean' ? c.hideDeployA2a : false,
    hideDeployChatbot: typeof c.hideDeployChatbot === 'boolean' ? c.hideDeployChatbot : false,
    hideDeployTemplate: typeof c.hideDeployTemplate === 'boolean' ? c.hideDeployTemplate : false,
  }
}
