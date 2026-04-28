/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  mockGetAllowedIntegrationsFromEnv,
  mockIsWorkspaceOnEnterprisePlan,
  mockGetProviderFromModel,
  mockDbGroupMembership,
} = vi.hoisted(() => ({
  DEFAULT_PERMISSION_GROUP_CONFIG: {
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
  },
  mockGetAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(),
  mockIsWorkspaceOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
  mockGetProviderFromModel: vi.fn<(model: string) => string>(),
  mockDbGroupMembership: { value: [] as Array<{ config: Record<string, unknown> }> },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.innerJoin = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.orderBy = vi.fn().mockReturnValue(chain)
      chain.limit = vi.fn().mockImplementation(() => Promise.resolve(mockDbGroupMembership.value))
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
  isWorkspaceOnEnterprisePlan: mockIsWorkspaceOnEnterprisePlan,
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
  ProviderNotAllowedError,
  SkillsNotAllowedError,
  validateBlockType,
  validateMcpToolsAllowed,
  validateModelProvider,
} from './permission-check'

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

describe('getUserPermissionConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupMembership.value = []
  })

  it('returns env allowlist config when access control is disabled locally', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack'])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).not.toBeNull()
    expect(config!.allowedIntegrations).toEqual(['slack'])
  })

  it('returns env allowlist config when workspace is not on enterprise plan', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    mockIsWorkspaceOnEnterprisePlan.mockResolvedValue(false)

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupMembership.value = []
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
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    mockIsWorkspaceOnEnterprisePlan.mockResolvedValue(true)
  })

  it('no-ops when user or workspace is missing', async () => {
    await validateModelProvider(undefined, 'workspace-1', 'gpt-4')
    await validateModelProvider('user-123', undefined, 'gpt-4')
  })

  it('throws ProviderNotAllowedError when provider is not in allowlist', async () => {
    mockDbGroupMembership.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })

  it('allows when provider is on the allowlist', async () => {
    mockDbGroupMembership.value = [{ config: { allowedModelProviders: ['anthropic', 'openai'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4')
  })
})

describe('validateMcpToolsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    mockIsWorkspaceOnEnterprisePlan.mockResolvedValue(true)
  })

  it('throws McpToolsNotAllowedError when disableMcpTools is set', async () => {
    mockDbGroupMembership.value = [{ config: { disableMcpTools: true } }]

    await expect(validateMcpToolsAllowed('user-123', 'workspace-1')).rejects.toBeInstanceOf(
      McpToolsNotAllowedError
    )
  })

  it('no-ops when disableMcpTools is false', async () => {
    mockDbGroupMembership.value = [{ config: {} }]

    await validateMcpToolsAllowed('user-123', 'workspace-1')
  })
})

describe('assertPermissionsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    mockIsWorkspaceOnEnterprisePlan.mockResolvedValue(true)
  })

  it('throws ProviderNotAllowedError when model provider is blocked', async () => {
    mockDbGroupMembership.value = [{ config: { allowedModelProviders: ['anthropic'] } }]
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        model: 'gpt-4',
      })
    ).rejects.toBeInstanceOf(ProviderNotAllowedError)
  })

  it('throws IntegrationNotAllowedError when block type is blocked', async () => {
    mockDbGroupMembership.value = [{ config: { allowedIntegrations: ['slack'] } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'discord',
      })
    ).rejects.toBeInstanceOf(IntegrationNotAllowedError)
  })

  it('throws CustomToolsNotAllowedError when custom tools are disabled', async () => {
    mockDbGroupMembership.value = [{ config: { disableCustomTools: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'custom',
      })
    ).rejects.toBeInstanceOf(CustomToolsNotAllowedError)
  })

  it('throws SkillsNotAllowedError when skills are disabled', async () => {
    mockDbGroupMembership.value = [{ config: { disableSkills: true } }]

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'skill',
      })
    ).rejects.toBeInstanceOf(SkillsNotAllowedError)
  })

  it('passes when the workspace has no blocking config', async () => {
    mockDbGroupMembership.value = []

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      model: 'gpt-4',
      blockType: 'slack',
      toolKind: 'mcp',
    })
  })
})
