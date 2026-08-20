import type { PermissionGroupConfig } from '@/lib/permission-groups/types'

type BooleanPermissionGroupConfigKey = {
  [Key in keyof PermissionGroupConfig]: PermissionGroupConfig[Key] extends boolean ? Key : never
}[keyof PermissionGroupConfig]

export interface PermissionGroupPlatformFeature {
  id: string
  label: string
  category: string
  configKey: BooleanPermissionGroupConfigKey
  hint: string
}

export interface ActivePermissionGroupRestriction {
  key: keyof PermissionGroupConfig
  description: string
}

/** Render order for the platform-feature category sections; unlisted ones follow. */
export const PLATFORM_CATEGORY_ORDER: readonly string[] = [
  'Sidebar',
  'Deploy Tabs',
  'Chat',
  'Collaboration',
  'Workflow Panel',
  'Tools',
  'Features',
  'Settings Tabs',
  'Logs',
  'Files',
] as const

/** User-facing descriptions shared by the Access Control editor and live permission context. */
export const PLATFORM_FEATURES = [
  {
    id: 'hide-knowledge-base',
    label: 'Knowledge Base',
    category: 'Sidebar',
    configKey: 'hideKnowledgeBaseTab',
    hint: 'Hide the Knowledge Base module from the sidebar.',
  },
  {
    id: 'hide-tables',
    label: 'Tables',
    category: 'Sidebar',
    configKey: 'hideTablesTab',
    hint: 'Hide the Tables module from the sidebar.',
  },
  {
    id: 'hide-copilot',
    label: 'Chat',
    category: 'Workflow Panel',
    configKey: 'hideCopilot',
    hint: 'Hide the Chat panel so users cannot build or edit with natural language.',
  },
  {
    id: 'hide-integrations',
    label: 'Integrations',
    category: 'Settings Tabs',
    configKey: 'hideIntegrationsTab',
    hint: 'Hide the Integrations settings tab (OAuth connections).',
  },
  {
    id: 'hide-secrets',
    label: 'Secrets',
    category: 'Settings Tabs',
    configKey: 'hideSecretsTab',
    hint: 'Hide the Secrets (environment variables) settings tab.',
  },
  {
    id: 'hide-api-keys',
    label: 'API Keys',
    category: 'Settings Tabs',
    configKey: 'hideApiKeysTab',
    hint: 'Hide the API Keys settings tab.',
  },
  {
    id: 'hide-files',
    label: 'Files',
    category: 'Settings Tabs',
    configKey: 'hideFilesTab',
    hint: 'Hide the Files settings tab.',
  },
  {
    id: 'hide-deploy-api',
    label: 'API',
    category: 'Deploy Tabs',
    configKey: 'hideDeployApi',
    hint: 'Hide the API deployment option.',
  },
  {
    id: 'hide-deploy-mcp',
    label: 'MCP',
    category: 'Deploy Tabs',
    configKey: 'hideDeployMcp',
    hint: 'Hide the MCP server deployment option.',
  },
  {
    id: 'disable-mcp',
    label: 'MCP Tools',
    category: 'Tools',
    configKey: 'disableMcpTools',
    hint: 'Block agents from calling MCP tools.',
  },
  {
    id: 'disable-custom-tools',
    label: 'Custom Tools',
    category: 'Tools',
    configKey: 'disableCustomTools',
    hint: 'Block agents from calling user-defined custom tools.',
  },
  {
    id: 'disable-skills',
    label: 'Skills',
    category: 'Tools',
    configKey: 'disableSkills',
    hint: 'Block agents from loading skills.',
  },
  {
    id: 'hide-trace-spans',
    label: 'Trace Spans',
    category: 'Logs',
    configKey: 'hideTraceSpans',
    hint: 'Hide per-block trace spans in logs.',
  },
  {
    id: 'disable-invitations',
    label: 'Invitations',
    category: 'Collaboration',
    configKey: 'disableInvitations',
    hint: 'Prevent users from inviting others to workspaces.',
  },
  {
    id: 'hide-inbox',
    label: 'Sim Mailer',
    category: 'Features',
    configKey: 'hideInboxTab',
    hint: 'Hide the Sim Mailer inbox.',
  },
  {
    id: 'disable-public-api',
    label: 'Public API',
    category: 'Features',
    configKey: 'disablePublicApi',
    hint: 'Disable public API access to deployed workflows.',
  },
  {
    id: 'hide-deploy-chatbot',
    label: 'Deployment',
    category: 'Chat',
    configKey: 'hideDeployChatbot',
    hint: 'Hide the chat deployment option.',
  },
  {
    id: 'disable-public-file-sharing',
    label: 'Public Sharing',
    category: 'Files',
    configKey: 'disablePublicFileSharing',
    hint: 'Disable public file-share links.',
  },
] as const satisfies readonly PermissionGroupPlatformFeature[]

/** Returns only restrictions that actively constrain the current user. */
export function getActivePermissionGroupRestrictions(
  config: PermissionGroupConfig | null
): ActivePermissionGroupRestriction[] {
  if (!config) return []

  const restrictions: ActivePermissionGroupRestriction[] = []

  if (config.allowedIntegrations !== null) {
    restrictions.push({
      key: 'allowedIntegrations',
      description:
        config.allowedIntegrations.length > 0
          ? 'Integrations and blocks are limited to effectiveConfig.allowedIntegrations.'
          : 'No non-exempt integrations or blocks are allowed.',
    })
  }
  if (config.allowedModelProviders !== null) {
    restrictions.push({
      key: 'allowedModelProviders',
      description:
        config.allowedModelProviders.length > 0
          ? 'Model providers are limited to effectiveConfig.allowedModelProviders.'
          : 'No model providers are allowed.',
    })
  }
  if (config.deniedModels.length > 0) {
    restrictions.push({
      key: 'deniedModels',
      description: 'Models listed in effectiveConfig.deniedModels are blocked.',
    })
  }
  if (config.deniedTools.length > 0) {
    restrictions.push({
      key: 'deniedTools',
      description: 'Integration tools listed in effectiveConfig.deniedTools are blocked.',
    })
  }
  if (config.allowedFileShareAuthTypes !== null) {
    restrictions.push({
      key: 'allowedFileShareAuthTypes',
      description:
        config.allowedFileShareAuthTypes.length > 0
          ? 'Public file-share authentication is limited to effectiveConfig.allowedFileShareAuthTypes.'
          : 'No public file-share authentication modes are allowed.',
    })
  }
  if (config.allowedChatDeployAuthTypes !== null) {
    restrictions.push({
      key: 'allowedChatDeployAuthTypes',
      description:
        config.allowedChatDeployAuthTypes.length > 0
          ? 'Chat deployment authentication is limited to effectiveConfig.allowedChatDeployAuthTypes.'
          : 'No chat deployment authentication modes are allowed.',
    })
  }

  for (const feature of PLATFORM_FEATURES) {
    if (config[feature.configKey]) {
      restrictions.push({ key: feature.configKey, description: feature.hint })
    }
  }

  return restrictions
}
