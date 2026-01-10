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
  hideTemplates: boolean
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
  hideTemplates: false,
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
    hideTemplates: typeof c.hideTemplates === 'boolean' ? c.hideTemplates : false,
  }
}
