export interface PermissionGroupConfig {
  allowedIntegrations: string[] | null
  allowedModelProviders: string[] | null
  hideTraceSpans: boolean
}

export const DEFAULT_PERMISSION_GROUP_CONFIG: PermissionGroupConfig = {
  allowedIntegrations: null,
  allowedModelProviders: null,
  hideTraceSpans: false,
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
  }
}
