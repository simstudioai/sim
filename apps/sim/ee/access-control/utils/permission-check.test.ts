/**
 * @vitest-environment node
 */
import { databaseMock, drizzleOrmMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  mockGetAllowedIntegrationsFromEnv,
  mockIsOrganizationOnEnterprisePlan,
  mockGetProviderFromModel,
} = vi.hoisted(() => ({
  DEFAULT_PERMISSION_GROUP_CONFIG: {
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
  },
  mockGetAllowedIntegrationsFromEnv: vi.fn<() => string[] | null>(),
  mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
  mockGetProviderFromModel: vi.fn<(model: string) => string>(),
}))

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/db/schema', () => ({}))
vi.mock('@sim/logger', () => loggerMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  getAllowedIntegrationsFromEnv: mockGetAllowedIntegrationsFromEnv,
  isAccessControlEnabled: false,
  isHosted: false,
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
  getUserPermissionConfig,
  IntegrationNotAllowedError,
  validateBlockType,
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
  })

  it('returns null when no env allowlist is configured', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)

    const config = await getUserPermissionConfig('user-123')

    expect(config).toBeNull()
  })

  it('returns config with env allowlist when configured', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack', 'gmail'])

    const config = await getUserPermissionConfig('user-123')

    expect(config).not.toBeNull()
    expect(config!.allowedIntegrations).toEqual(['slack', 'gmail'])
  })

  it('preserves default values for non-allowlist fields', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack'])

    const config = await getUserPermissionConfig('user-123')

    expect(config!.disableMcpTools).toBe(false)
    expect(config!.allowedModelProviders).toBeNull()
  })
})

describe('env allowlist fallback when userId is absent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null allowlist when no userId and no env allowlist', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)

    const userId: string | undefined = undefined
    const permissionConfig = userId ? await getUserPermissionConfig(userId) : null
    const allowedIntegrations =
      permissionConfig?.allowedIntegrations ?? mockGetAllowedIntegrationsFromEnv()

    expect(allowedIntegrations).toBeNull()
  })

  it('falls back to env allowlist when no userId is provided', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack', 'gmail'])

    const userId: string | undefined = undefined
    const permissionConfig = userId ? await getUserPermissionConfig(userId) : null
    const allowedIntegrations =
      permissionConfig?.allowedIntegrations ?? mockGetAllowedIntegrationsFromEnv()

    expect(allowedIntegrations).toEqual(['slack', 'gmail'])
  })

  it('env allowlist filters block types when userId is absent', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack', 'gmail'])

    const userId: string | undefined = undefined
    const permissionConfig = userId ? await getUserPermissionConfig(userId) : null
    const allowedIntegrations =
      permissionConfig?.allowedIntegrations ?? mockGetAllowedIntegrationsFromEnv()

    expect(allowedIntegrations).not.toBeNull()
    expect(allowedIntegrations!.includes('slack')).toBe(true)
    expect(allowedIntegrations!.includes('discord')).toBe(false)
  })

  it('uses permission config when userId is present, ignoring env fallback', async () => {
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack', 'gmail'])

    const config = await getUserPermissionConfig('user-123')

    expect(config).not.toBeNull()
    expect(config!.allowedIntegrations).toEqual(['slack', 'gmail'])
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when no env allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    })

    it('allows any block type', async () => {
      await validateBlockType(undefined, 'google_drive')
    })

    it('allows multi-word block types', async () => {
      await validateBlockType(undefined, 'microsoft_excel')
    })

    it('always allows start_trigger', async () => {
      await validateBlockType(undefined, 'start_trigger')
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
      await validateBlockType(undefined, 'slack')
      await validateBlockType(undefined, 'google_drive')
      await validateBlockType(undefined, 'microsoft_excel')
    })

    it('rejects block types not on the allowlist', async () => {
      await expect(validateBlockType(undefined, 'discord')).rejects.toThrow(
        IntegrationNotAllowedError
      )
    })

    it('always allows start_trigger regardless of allowlist', async () => {
      await validateBlockType(undefined, 'start_trigger')
    })

    it('matches case-insensitively', async () => {
      await validateBlockType(undefined, 'Slack')
      await validateBlockType(undefined, 'GOOGLE_DRIVE')
    })

    it('includes env reason in error when env allowlist is the source', async () => {
      await expect(validateBlockType(undefined, 'discord')).rejects.toThrow(/ALLOWED_INTEGRATIONS/)
    })

    it('includes env reason even when userId is present if env is the source', async () => {
      await expect(validateBlockType('user-123', 'discord')).rejects.toThrow(/ALLOWED_INTEGRATIONS/)
    })
  })
})

describe('service ID to block type normalization', () => {
  it.concurrent('hyphenated service IDs match underscore block types after normalization', () => {
    const allowedBlockTypes = [
      'google_drive',
      'microsoft_excel',
      'microsoft_teams',
      'google_sheets',
      'google_docs',
      'google_calendar',
      'google_forms',
      'microsoft_planner',
    ]
    const serviceIds = [
      'google-drive',
      'microsoft-excel',
      'microsoft-teams',
      'google-sheets',
      'google-docs',
      'google-calendar',
      'google-forms',
      'microsoft-planner',
    ]

    for (const serviceId of serviceIds) {
      const normalized = serviceId.replace(/-/g, '_')
      expect(allowedBlockTypes).toContain(normalized)
    }
  })

  it.concurrent('single-word service IDs are unaffected by normalization', () => {
    const serviceIds = ['slack', 'gmail', 'notion', 'discord', 'jira', 'trello']

    for (const serviceId of serviceIds) {
      const normalized = serviceId.replace(/-/g, '_')
      expect(normalized).toBe(serviceId)
    }
  })
})
