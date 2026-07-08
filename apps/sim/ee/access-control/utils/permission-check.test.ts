/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  mockGetAllowedIntegrationsFromEnv,
  mockIsOrganizationOnEnterprisePlan,
  mockGetWorkspaceWithOwner,
  mockGetProviderFromModel,
  mockGetBlock,
  mockWorkspaceGroups,
  mockDefaultGroup,
} = vi.hoisted(() => ({
  DEFAULT_PERMISSION_GROUP_CONFIG: {
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
  },
  mockGetAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
  mockGetWorkspaceWithOwner: vi.fn<() => Promise<{ organizationId: string | null } | null>>(),
  mockGetProviderFromModel: vi.fn<(model: string) => string>(),
  mockGetBlock: vi.fn<(type: string) => { hideFromToolbar?: boolean } | undefined>(),
  // resolveWorkspaceGroup selects non-default groups targeting the workspace
  // (FROM permissionGroup INNER JOIN permissionGroupWorkspace), awaiting the
  // builder directly; each row carries `isMember`/`hasMembers` booleans. A row
  // with neither flag set reads as an all-members group (hasMembers falsy).
  // resolveDefaultGroup selects the org default directly with limit(1), no join.
  // The db mock branches on whether an inner join was used.
  mockWorkspaceGroups: {
    value: [] as Array<{
      id?: string
      name?: string
      config: Record<string, unknown>
      isMember?: boolean
      hasMembers?: boolean
    }>,
  },
  mockDefaultGroup: { value: [] as Array<{ config: Record<string, unknown> }> },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      let usedInnerJoin = false
      const resolveRows = () => (usedInnerJoin ? mockWorkspaceGroups.value : mockDefaultGroup.value)
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.innerJoin = vi.fn().mockImplementation(() => {
        usedInnerJoin = true
        return chain
      })
      chain.leftJoin = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.orderBy = vi.fn().mockReturnValue(chain)
      chain.limit = vi.fn().mockImplementation(() => Promise.resolve(resolveRows()))
      // resolveWorkspaceGroup awaits the builder directly after `orderBy` (no
      // limit), so the chain must be thenable.
      chain.then = (onFulfilled: (rows: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(onFulfilled)
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {},
  permissionGroupMember: {},
  permissionGroupWorkspace: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  getAllowedIntegrationsFromEnv: mockGetAllowedIntegrationsFromEnv,
  isAccessControlEnabled: true,
  isHosted: true,
  isInvitationsDisabled: false,
  isPublicApiDisabled: false,
}))

vi.mock('@/lib/permission-groups/types', () => ({
  DEFAULT_PERMISSION_GROUP_CONFIG,
  parsePermissionGroupConfig: (config: unknown) => {
    if (!config || typeof config !== 'object') return DEFAULT_PERMISSION_GROUP_CONFIG
    return { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...config }
  },
}))

vi.mock('@/providers/utils', () => ({
  getProviderFromModel: mockGetProviderFromModel,
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getAllBlocks: vi.fn(() => []),
}))

import {
  assertPermissionsAllowed,
  CustomToolsNotAllowedError,
  getUserPermissionConfig,
  IntegrationNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  PublicFileSharingNotAllowedError,
  SkillsNotAllowedError,
  ToolNotAllowedError,
  validateBlockType,
  validateMcpToolsAllowed,
  validateModelProvider,
  validatePublicFileSharing,
} from './permission-check'

/** Default an org-backed, enterprise-entitled workspace so resolution reaches the group queries. */
function setEnterpriseOrgWorkspace() {
  mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: 'org-1' })
  mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
}

/**
 * Default every block to non-legacy. `vi.clearAllMocks()` (used by the
 * describe-level hooks) keeps implementations, so reset here to stop a legacy
 * `getBlock` implementation set in one test from leaking into later ones.
 */
beforeEach(() => {
  mockGetBlock.mockImplementation(() => undefined)
})

describe('IntegrationNotAllowedError', () => {
  it.concurrent('creates error with correct name and message', () => {
    const error = new IntegrationNotAllowedError('discord')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('IntegrationNotAllowedError')
    expect(error.message).toContain('discord')
  })

  it.concurrent('includes custom reason when provided', () => {
    const error = new IntegrationNotAllowedError('discord', 'blocked by server policy')

    expect(error.message).toContain('blocked by server policy')
  })
})

describe('getUserPermissionConfig (org + entitlement gating)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
  })

  it('returns null when the workspace has no organization', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: null })

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('still applies the env allowlist on a no-org workspace', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: null })
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack'])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.allowedIntegrations).toEqual(['slack'])
  })

  it('returns null when the organization is not on an enterprise plan', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: 'org-1' })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })

  it('falls back to the org default group when no workspace group governs the user', async () => {
    setEnterpriseOrgWorkspace()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = [{ config: { disableSkills: true } }]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })

  it('governs an external member via the org default group', async () => {
    setEnterpriseOrgWorkspace()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = [{ config: { disableCustomTools: true } }]

    const config = await getUserPermissionConfig('external-user', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
  })

  it('returns null when no workspace group and no default group apply', async () => {
    setEnterpriseOrgWorkspace()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })
})

describe('getUserPermissionConfig (workspace-group precedence)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('governs an explicit member via their workspace group', async () => {
    mockWorkspaceGroups.value = [
      { id: 'g', config: { disableMcpTools: true }, isMember: true, hasMembers: true },
    ]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableMcpTools).toBe(true)
  })

  it('governs all members (including non-listed) via an all-members group', async () => {
    mockWorkspaceGroups.value = [
      { id: 'g', config: { disableSkills: true }, isMember: false, hasMembers: false },
    ]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })

  it('governs an external member via an all-members group', async () => {
    mockWorkspaceGroups.value = [
      { id: 'g', config: { disableCustomTools: true }, isMember: false, hasMembers: false },
    ]

    const config = await getUserPermissionConfig('external-user', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
  })

  it('prefers an explicit-member group over an all-members group on the same workspace', async () => {
    mockWorkspaceGroups.value = [
      { id: 'all', config: { disableMcpTools: true }, isMember: false, hasMembers: false },
      { id: 'explicit', config: { disableSkills: true }, isMember: true, hasMembers: true },
    ]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
    expect(config?.disableMcpTools).toBe(false)
  })

  it('a narrowed group (has members) does not govern a non-member; falls back to default', async () => {
    mockWorkspaceGroups.value = [
      { id: 'narrowed', config: { disableSkills: true }, isMember: false, hasMembers: true },
    ]
    mockDefaultGroup.value = [{ config: { disableCustomTools: true } }]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
    expect(config?.disableSkills).toBe(false)
  })

  it('a narrowed group does not govern a non-member; unrestricted when no default', async () => {
    mockWorkspaceGroups.value = [
      { id: 'narrowed', config: { disableSkills: true }, isMember: false, hasMembers: true },
    ]
    mockDefaultGroup.value = []

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
  })

  describe('when no env allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    })

    it('allows any block type', async () => {
      await validateBlockType(undefined, undefined, 'google_drive')
    })

    it('allows multi-word block types', async () => {
      await validateBlockType(undefined, undefined, 'microsoft_excel')
    })

    it('always allows start_trigger', async () => {
      await validateBlockType(undefined, undefined, 'start_trigger')
    })
  })

  describe('when env allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedIntegrationsFromEnv.mockReturnValue([
        'slack',
        'google_drive',
        'microsoft_excel',
      ])
    })

    it('allows block types on the allowlist', async () => {
      await validateBlockType(undefined, undefined, 'slack')
      await validateBlockType(undefined, undefined, 'google_drive')
      await validateBlockType(undefined, undefined, 'microsoft_excel')
    })

    it('rejects block types not on the allowlist', async () => {
      await expect(validateBlockType(undefined, undefined, 'discord')).rejects.toThrow(
        IntegrationNotAllowedError
      )
    })

    it('always allows start_trigger regardless of allowlist', async () => {
      await validateBlockType(undefined, undefined, 'start_trigger')
    })

    it('always allows legacy blocks hidden from the toolbar', async () => {
      mockGetBlock.mockImplementation((type) =>
        type === 'notion' ? { hideFromToolbar: true } : undefined
      )

      await validateBlockType(undefined, undefined, 'notion')
    })

    it('matches case-insensitively', async () => {
      await validateBlockType(undefined, undefined, 'Slack')
      await validateBlockType(undefined, undefined, 'GOOGLE_DRIVE')
    })

    it('includes env reason in error when env allowlist is the source', async () => {
      await expect(validateBlockType(undefined, undefined, 'discord')).rejects.toThrow(
        /ALLOWED_INTEGRATIONS/
      )
    })

    it('includes env reason even when a workspace is in context', async () => {
      await expect(validateBlockType('user-123', 'workspace-1', 'discord')).rejects.toThrow(
        /ALLOWED_INTEGRATIONS/
      )
    })
  })
})

describe('validateModelProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('no-ops when user or workspace is missing', async () => {
    await validateModelProvider(undefined, 'workspace-1', 'gpt-4')
    await validateModelProvider('user-123', undefined, 'gpt-4')
  })

  it('throws ProviderNotAllowedError when provider is not in allowlist', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })

  it('allows when provider is on the allowlist', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedModelProviders: ['anthropic', 'openai'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4')
  })

  it('throws ModelNotAllowedError when the model is on the denylist', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })

  it('denylist match is case-insensitive', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedModels: ['Ollama/Llama3'] } }]
    mockGetProviderFromModel.mockReturnValue('ollama')

    await expect(
      validateModelProvider('user-123', 'workspace-1', 'ollama/llama3')
    ).rejects.toBeInstanceOf(ModelNotAllowedError)
  })

  it('enforces the denylist even when no provider allowlist is set', async () => {
    mockWorkspaceGroups.value = [
      { config: { allowedModelProviders: null, deniedModels: ['gpt-4'] } },
    ]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })

  it('allows a model that is not on the denylist', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4o')
  })

  it('applies the org default group when no workspace group governs the user', async () => {
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })
})

describe('validateMcpToolsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws McpToolsNotAllowedError when disableMcpTools is set', async () => {
    mockWorkspaceGroups.value = [{ config: { disableMcpTools: true } }]

    await expect(validateMcpToolsAllowed('user-123', 'workspace-1')).rejects.toBeInstanceOf(
      McpToolsNotAllowedError
    )
  })

  it('no-ops when disableMcpTools is false', async () => {
    mockWorkspaceGroups.value = [{ config: {} }]

    await validateMcpToolsAllowed('user-123', 'workspace-1')
  })
})

describe('validatePublicFileSharing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws when public file sharing is fully disabled', async () => {
    mockWorkspaceGroups.value = [{ config: { disablePublicFileSharing: true } }]
    await expect(
      validatePublicFileSharing('user-123', 'workspace-1', 'password')
    ).rejects.toBeInstanceOf(PublicFileSharingNotAllowedError)
  })

  it('throws when the auth type is not in the allow-list', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedFileShareAuthTypes: ['password', 'sso'] } }]
    await expect(
      validatePublicFileSharing('user-123', 'workspace-1', 'public')
    ).rejects.toBeInstanceOf(PublicFileSharingNotAllowedError)
  })

  it('allows an auth type that is in the allow-list', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedFileShareAuthTypes: ['password', 'sso'] } }]
    await validatePublicFileSharing('user-123', 'workspace-1', 'password')
  })

  it('allows any auth type when the allow-list is null', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedFileShareAuthTypes: null } }]
    await validatePublicFileSharing('user-123', 'workspace-1', 'email')
  })

  it('no-ops when no auth type is provided (master switch only)', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedFileShareAuthTypes: ['password'] } }]
    await validatePublicFileSharing('user-123', 'workspace-1')
  })
})

describe('assertPermissionsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws ProviderNotAllowedError when model provider is blocked', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        model: 'gpt-4',
      })
    ).rejects.toBeInstanceOf(ProviderNotAllowedError)
  })

  it('throws ModelNotAllowedError when the model is on the denylist', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        model: 'gpt-4',
      })
    ).rejects.toBeInstanceOf(ModelNotAllowedError)
  })

  it('throws IntegrationNotAllowedError when block type is blocked', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedIntegrations: ['slack'] } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'discord',
      })
    ).rejects.toBeInstanceOf(IntegrationNotAllowedError)
  })

  it('exempts legacy blocks from the integration allowlist', async () => {
    mockWorkspaceGroups.value = [{ config: { allowedIntegrations: ['slack'] } }]
    mockGetBlock.mockImplementation((type) =>
      type === 'notion' ? { hideFromToolbar: true } : undefined
    )

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      blockType: 'notion',
    })
  })

  it('throws ToolNotAllowedError when the tool is on the denylist', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedTools: ['slack_canvas'] } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolId: 'slack_canvas',
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)
  })

  it('allows a tool that is not on the denylist', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedTools: ['slack_canvas'] } }]

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      toolId: 'slack_message',
    })
  })

  it('allows every tool when the denylist is empty', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedTools: [] } }]

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      toolId: 'slack_canvas',
    })
  })

  it('denies a tool even when its block is allowed by the integration allowlist', async () => {
    mockWorkspaceGroups.value = [
      { config: { allowedIntegrations: ['slack'], deniedTools: ['slack_canvas'] } },
    ]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'slack',
        toolId: 'slack_canvas',
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)
  })

  it('still enforces the tool denylist for an exempt block type', async () => {
    mockWorkspaceGroups.value = [{ config: { deniedTools: ['slack_canvas'] } }]
    mockGetBlock.mockImplementation((type) =>
      type === 'slack' ? { hideFromToolbar: true } : undefined
    )

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'slack',
        toolId: 'slack_canvas',
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)
  })

  it('throws CustomToolsNotAllowedError when custom tools are disabled', async () => {
    mockWorkspaceGroups.value = [{ config: { disableCustomTools: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'custom',
      })
    ).rejects.toBeInstanceOf(CustomToolsNotAllowedError)
  })

  it('throws SkillsNotAllowedError when skills are disabled', async () => {
    mockWorkspaceGroups.value = [{ config: { disableSkills: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'skill',
      })
    ).rejects.toBeInstanceOf(SkillsNotAllowedError)
  })

  it('passes when the workspace has no blocking config', async () => {
    mockWorkspaceGroups.value = []
    mockDefaultGroup.value = []

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      model: 'gpt-4',
      blockType: 'slack',
      toolKind: 'mcp',
    })
  })
})
