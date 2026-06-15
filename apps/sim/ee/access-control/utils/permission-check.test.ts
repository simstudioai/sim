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
  mockExplicitGroup,
  mockDefaultGroup,
} = vi.hoisted(() => ({
  DEFAULT_PERMISSION_GROUP_CONFIG: {
    allowedIntegrations: null,
    allowedModelProviders: null,
    deniedModels: [],
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
  },
  mockGetAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
  mockGetWorkspaceWithOwner: vi.fn<() => Promise<{ organizationId: string | null } | null>>(),
  mockGetProviderFromModel: vi.fn<(model: string) => string>(),
  // The explicit-group query joins permission_group_member -> permission_group;
  // the org-default query selects permission_group directly. The db mock returns
  // the explicit rows when `innerJoin` was called and the default rows otherwise.
  mockExplicitGroup: { value: [] as Array<{ config: Record<string, unknown> }> },
  mockDefaultGroup: { value: [] as Array<{ config: Record<string, unknown> }> },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      let usedInnerJoin = false
      chain.from = vi.fn().mockReturnValue(chain)
      chain.innerJoin = vi.fn().mockImplementation(() => {
        usedInnerJoin = true
        return chain
      })
      chain.where = vi.fn().mockReturnValue(chain)
      chain.orderBy = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(usedInnerJoin ? mockExplicitGroup.value : mockDefaultGroup.value)
        )
      return chain
    }),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissionGroup: {},
  permissionGroupMember: {},
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  asc: vi.fn(),
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
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

import {
  assertPermissionsAllowed,
  CustomToolsNotAllowedError,
  getUserPermissionConfig,
  IntegrationNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  SkillsNotAllowedError,
  validateBlockType,
  validateMcpToolsAllowed,
  validateModelProvider,
} from './permission-check'

/** Default an org-backed, enterprise-entitled workspace so resolution reaches the group queries. */
function setEnterpriseOrgWorkspace() {
  mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: 'org-1' })
  mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
}

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

describe('getUserPermissionConfig (org-scoped resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExplicitGroup.value = []
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

  it('returns the explicit group config when the user is assigned to one', async () => {
    setEnterpriseOrgWorkspace()
    mockExplicitGroup.value = [{ config: { disableMcpTools: true } }]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableMcpTools).toBe(true)
  })

  it('falls back to the org default group when the user has no explicit group', async () => {
    setEnterpriseOrgWorkspace()
    mockExplicitGroup.value = []
    mockDefaultGroup.value = [{ config: { disableSkills: true } }]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })

  it('governs an external member (no explicit group) via the org default group', async () => {
    setEnterpriseOrgWorkspace()
    mockExplicitGroup.value = []
    mockDefaultGroup.value = [{ config: { disableCustomTools: true } }]

    const config = await getUserPermissionConfig('external-user', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
  })

  it('returns null when there is no explicit group and no default group', async () => {
    setEnterpriseOrgWorkspace()
    mockExplicitGroup.value = []
    mockDefaultGroup.value = []

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })

  it('prefers the explicit group over the org default group', async () => {
    setEnterpriseOrgWorkspace()
    mockExplicitGroup.value = [{ config: { disableMcpTools: true } }]
    mockDefaultGroup.value = [{ config: { disableSkills: true } }]

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableMcpTools).toBe(true)
    expect(config?.disableSkills).toBe(false)
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExplicitGroup.value = []
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
    mockExplicitGroup.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('no-ops when user or workspace is missing', async () => {
    await validateModelProvider(undefined, 'workspace-1', 'gpt-4')
    await validateModelProvider('user-123', undefined, 'gpt-4')
  })

  it('throws ProviderNotAllowedError when provider is not in allowlist', async () => {
    mockExplicitGroup.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })

  it('allows when provider is on the allowlist', async () => {
    mockExplicitGroup.value = [{ config: { allowedModelProviders: ['anthropic', 'openai'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4')
  })

  it('throws ModelNotAllowedError when the model is on the denylist', async () => {
    mockExplicitGroup.value = [{ config: { deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })

  it('denylist match is case-insensitive', async () => {
    mockExplicitGroup.value = [{ config: { deniedModels: ['Ollama/Llama3'] } }]
    mockGetProviderFromModel.mockReturnValue('ollama')

    await expect(
      validateModelProvider('user-123', 'workspace-1', 'ollama/llama3')
    ).rejects.toBeInstanceOf(ModelNotAllowedError)
  })

  it('enforces the denylist even when no provider allowlist is set', async () => {
    mockExplicitGroup.value = [{ config: { allowedModelProviders: null, deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })

  it('allows a model that is not on the denylist', async () => {
    mockExplicitGroup.value = [{ config: { deniedModels: ['gpt-4'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4o')
  })

  it('applies the org default group when the user has no explicit group', async () => {
    mockExplicitGroup.value = []
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
    mockExplicitGroup.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws McpToolsNotAllowedError when disableMcpTools is set', async () => {
    mockExplicitGroup.value = [{ config: { disableMcpTools: true } }]

    await expect(validateMcpToolsAllowed('user-123', 'workspace-1')).rejects.toBeInstanceOf(
      McpToolsNotAllowedError
    )
  })

  it('no-ops when disableMcpTools is false', async () => {
    mockExplicitGroup.value = [{ config: {} }]

    await validateMcpToolsAllowed('user-123', 'workspace-1')
  })
})

describe('assertPermissionsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExplicitGroup.value = []
    mockDefaultGroup.value = []
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws ProviderNotAllowedError when model provider is blocked', async () => {
    mockExplicitGroup.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
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
    mockExplicitGroup.value = [{ config: { deniedModels: ['gpt-4'] } }]
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
    mockExplicitGroup.value = [{ config: { allowedIntegrations: ['slack'] } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'discord',
      })
    ).rejects.toBeInstanceOf(IntegrationNotAllowedError)
  })

  it('throws CustomToolsNotAllowedError when custom tools are disabled', async () => {
    mockExplicitGroup.value = [{ config: { disableCustomTools: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'custom',
      })
    ).rejects.toBeInstanceOf(CustomToolsNotAllowedError)
  })

  it('throws SkillsNotAllowedError when skills are disabled', async () => {
    mockExplicitGroup.value = [{ config: { disableSkills: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'skill',
      })
    ).rejects.toBeInstanceOf(SkillsNotAllowedError)
  })

  it('passes when the workspace has no blocking config', async () => {
    mockExplicitGroup.value = []
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
