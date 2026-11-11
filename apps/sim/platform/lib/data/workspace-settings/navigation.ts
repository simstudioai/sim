import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'

/**
 * A workspace's Settings sections, in navigation order, with the gates the legacy settings sidebar
 * applied to them. Hiding an entry is navigation: every API behind a section refuses on its own.
 */
const WORKSPACE_SETTINGS = [
  {
    label: 'Workspace',
    items: [
      {
        key: 'teammates',
        title: 'Teammates',
        icon: 'I133',
        description: 'Invite people to this workspace and manage their access',
        mutate: 'admin',
      },
      {
        key: 'secrets',
        title: 'Secrets',
        icon: 'I137',
        description: 'Store the keys and tokens your workflows use',
        mutate: 'write',
        restrictedBy: 'hideSecretsTab',
      },
      {
        key: 'byok',
        title: 'BYOK',
        icon: 'I128',
        description: 'Use your own model provider keys in this workspace',
        mutate: 'admin',
        hostedOnly: true,
      },
      {
        key: 'sandboxes',
        title: 'Sandboxes',
        icon: 'I107',
        description: 'Choose the packages and tools your Function blocks can use',
        mutate: 'admin',
        restrictedBy: 'hideSandboxesTab',
      },
      {
        key: 'requests',
        title: 'Requests',
        icon: 'I073',
        description: 'Review requests for access in this workspace',
        mutate: 'read',
      },
    ],
  },
  {
    label: 'Tools',
    items: [
      {
        key: 'custom-tools',
        title: 'Custom tools',
        icon: 'I127',
        description: 'Build tools your agents can call',
        mutate: 'write',
        restrictedBy: 'disableCustomTools',
      },
      {
        key: 'mcp',
        title: 'MCP tools',
        icon: 'I126',
        description: 'Connect MCP servers and use their tools in workflows',
        mutate: 'write',
        restrictedBy: 'disableMcpTools',
      },
      {
        key: 'workflow-mcp-servers',
        title: 'MCP servers',
        icon: 'I118',
        description: 'Serve your deployed workflows as MCP tools',
        mutate: 'write',
      },
    ],
  },
  {
    label: 'Developer',
    items: [
      {
        key: 'api-keys',
        title: 'Sim API keys',
        icon: 'I041',
        description: 'Manage the keys your apps use to call the Sim API',
        mutate: 'admin',
        restrictedBy: 'hideApiKeysTab',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        key: 'inbox',
        title: 'Sim Mailer',
        icon: 'I106',
        description: 'Send tasks to this workspace by email',
        mutate: 'admin',
        restrictedBy: 'hideInboxTab',
      },
      {
        key: 'recently-deleted',
        title: 'Recently deleted',
        icon: 'I053',
        description: 'Restore deleted work before it is removed for good',
        mutate: 'write',
      },
    ],
  },
  {
    label: 'Enterprise',
    items: [
      {
        key: 'forks',
        title: 'Workspace forks',
        icon: 'I129',
        description: 'Copy this workspace and keep its forks in sync',
        mutate: 'admin',
      },
      {
        key: 'custom-blocks',
        title: 'Custom blocks',
        icon: 'I025',
        description: 'Publish deployed workflows as reusable blocks',
        mutate: 'admin',
      },
    ],
  },
] as const satisfies readonly {
  label: string
  items: readonly {
    key: string
    title: string
    icon: IconName
    /** The line under the section's title, in Paper's voice: sentence case, no closing period. */
    description: string
    /** The workspace permission that may change what the section shows. */
    mutate: 'read' | 'write' | 'admin'
    /** The permission-group flag that hides the section. */
    restrictedBy?: BooleanPermissionGroupConfigKey
    /** Offered on Sim Cloud only. */
    hostedOnly?: true
  }[]
}[]

type WorkspaceSettingDefinition = (typeof WORKSPACE_SETTINGS)[number]['items'][number]

export type WorkspaceSettingsKey = WorkspaceSettingDefinition['key']

const DEFINITIONS: readonly WorkspaceSettingDefinition[] = WORKSPACE_SETTINGS.flatMap(
  (group): readonly WorkspaceSettingDefinition[] => group.items
)

export function isWorkspaceSettingsKey(key: string): key is WorkspaceSettingsKey {
  return DEFINITIONS.some((item) => item.key === key)
}

/** The section's title, for the tab title and the heading. */
export function workspaceSettingTitle(key: string): string {
  return DEFINITIONS.find((item) => item.key === key)?.title ?? 'Settings'
}

/** The permission-group flag that withholds a section, which other surfaces linking to it honor too. */
export function workspaceSettingRestriction(
  key: WorkspaceSettingsKey
): BooleanPermissionGroupConfigKey | undefined {
  const item = DEFINITIONS.find((candidate) => candidate.key === key)
  return item && 'restrictedBy' in item ? item.restrictedBy : undefined
}

export interface WorkspaceSettingsGateInput {
  hostContext: WorkspaceHostContext
  /** The viewer's permission-group flags in this workspace. */
  permissionConfig: Partial<Record<BooleanPermissionGroupConfigKey, boolean>>
  /** Flags the viewer may ask an administrator to lift. */
  requestable: ReadonlySet<string>
  hasUsableEnterpriseAccess: boolean
  hasUsableMaxAccess: boolean
  forkingAvailable: boolean
  inboxEntitled: boolean
}

export interface WorkspaceSetting {
  key: WorkspaceSettingsKey
  title: string
  description: string
  icon: IconName
  /** The viewer's workspace permission allows the section's changes. */
  canMutate: boolean
  /** Shown, but the plan does not include it yet: the section offers the upgrade. */
  locked: boolean
  /** Shown because the viewer may request it; the section asks for access instead of rendering. */
  restrictedBy?: BooleanPermissionGroupConfigKey
}

const PERMISSION_RANK = { read: 0, write: 1, admin: 2 } as const

function selfHostedOverride(
  { deployment }: WorkspaceHostContext,
  feature: 'customBlocks' | 'inbox' | 'sandboxes'
) {
  return Boolean(deployment && !deployment.hosted && deployment.features[feature])
}

/** The legacy sidebar's filter for each workspace section, returning what the viewer sees. */
function resolveEntry(
  item: WorkspaceSettingDefinition,
  input: WorkspaceSettingsGateInput
): Omit<WorkspaceSetting, 'key' | 'title' | 'description' | 'icon' | 'canMutate'> | null {
  const { hostContext, permissionConfig, requestable } = input
  const hosted = hostContext.deployment?.hosted ?? true
  const restrictedBy = 'restrictedBy' in item ? item.restrictedBy : undefined
  const restricted = Boolean(restrictedBy && permissionConfig[restrictedBy])
  if (restricted && restrictedBy && !requestable.has(restrictedBy)) return null
  const gate = restricted ? { locked: false, restrictedBy } : { locked: false }
  if ('hostedOnly' in item && !hosted) return null
  switch (item.key) {
    case 'requests':
      return hostContext.hostOrganizationId ? gate : null
    case 'forks':
      return input.forkingAvailable && hostContext.viewer.permission === 'admin' ? gate : null
    case 'custom-blocks':
      if (!hostContext.hostOrganizationId) return null
      if (selfHostedOverride(hostContext, 'customBlocks')) return gate
      return hosted && input.hasUsableEnterpriseAccess ? gate : null
    case 'sandboxes':
      if (selfHostedOverride(hostContext, 'sandboxes')) return gate
      return { ...gate, locked: !input.hasUsableMaxAccess }
    case 'inbox':
      if (selfHostedOverride(hostContext, 'inbox')) return gate
      return hosted ? { ...gate, locked: !input.inboxEntitled } : null
    default:
      return gate
  }
}

/** The sections this viewer may open in this workspace, grouped in navigation order. */
export function resolveWorkspaceSettings(input: WorkspaceSettingsGateInput) {
  const rank = PERMISSION_RANK[input.hostContext.viewer.permission]
  return WORKSPACE_SETTINGS.map((group) => ({
    label: group.label,
    items: (group.items as readonly WorkspaceSettingDefinition[]).flatMap(
      (item): WorkspaceSetting[] => {
        const gate = resolveEntry(item, input)
        if (!gate) return []
        return [
          {
            key: item.key,
            title: item.title,
            description: item.description,
            icon: item.icon,
            canMutate: !gate.locked && rank >= PERMISSION_RANK[item.mutate],
            ...gate,
          },
        ]
      }
    ),
  })).filter((group) => group.items.length > 0)
}
