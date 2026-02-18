/**
 * @vitest-environment node
 */
import { databaseMock, drizzleOrmMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_PERMISSION_GROUP_CONFIG = {
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

const mockGetAllowedIntegrationsFromEnv = vi.fn<() => string[] | null>()
const mockIsOrganizationOnEnterprisePlan = vi.fn<() => Promise<boolean>>()
const mockGetProviderFromModel = vi.fn<(model: string) => string>()

vi.doMock('@sim/db', () => databaseMock)
vi.doMock('@sim/db/schema', () => ({}))
vi.doMock('@sim/logger', () => loggerMock)
vi.doMock('drizzle-orm', () => drizzleOrmMock)
vi.doMock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))
vi.doMock('@/lib/core/config/feature-flags', () => ({
  getAllowedIntegrationsFromEnv: mockGetAllowedIntegrationsFromEnv,
  isAccessControlEnabled: false,
  isHosted: false,
}))
vi.doMock('@/lib/permission-groups/types', () => ({
  DEFAULT_PERMISSION_GROUP_CONFIG,
  parsePermissionGroupConfig: (config: unknown) => {
    if (!config || typeof config !== 'object') return DEFAULT_PERMISSION_GROUP_CONFIG
    return { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...config }
  },
}))
vi.doMock('@/providers/utils', () => ({
  getProviderFromModel: mockGetProviderFromModel,
}))

const { IntegrationNotAllowedError, validateBlockType } = await import('./permission-check')

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when no env allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    })

    it('allows any block type', async () => {
      await expect(validateBlockType(undefined, 'google_drive')).resolves.not.toThrow()
    })

    it('allows multi-word block types', async () => {
      await expect(validateBlockType(undefined, 'microsoft_excel')).resolves.not.toThrow()
    })

    it('always allows start_trigger', async () => {
      await expect(validateBlockType(undefined, 'start_trigger')).resolves.not.toThrow()
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
      await expect(validateBlockType(undefined, 'slack')).resolves.not.toThrow()
      await expect(validateBlockType(undefined, 'google_drive')).resolves.not.toThrow()
      await expect(validateBlockType(undefined, 'microsoft_excel')).resolves.not.toThrow()
    })

    it('rejects block types not on the allowlist', async () => {
      await expect(validateBlockType(undefined, 'discord')).rejects.toThrow(
        IntegrationNotAllowedError
      )
    })

    it('always allows start_trigger regardless of allowlist', async () => {
      await expect(validateBlockType(undefined, 'start_trigger')).resolves.not.toThrow()
    })

    it('matches case-insensitively', async () => {
      await expect(validateBlockType(undefined, 'Slack')).resolves.not.toThrow()
      await expect(validateBlockType(undefined, 'GOOGLE_DRIVE')).resolves.not.toThrow()
    })

    it('includes reason in error for env-only enforcement', async () => {
      await expect(validateBlockType(undefined, 'discord')).rejects.toThrow(/ALLOWED_INTEGRATIONS/)
    })
  })
})

describe('service ID to block type normalization', () => {
  it('hyphenated service IDs match underscore block types after normalization', () => {
    const allowedBlockTypes = [
      'google_drive',
      'microsoft_excel',
      'microsoft_teams',
      'google_sheets',
    ]
    const serviceIds = ['google-drive', 'microsoft-excel', 'microsoft-teams', 'google-sheets']

    for (const serviceId of serviceIds) {
      const normalized = serviceId.replace(/-/g, '_')
      expect(allowedBlockTypes).toContain(normalized)
    }
  })

  it('single-word service IDs are unaffected by normalization', () => {
    const serviceIds = ['slack', 'gmail', 'notion', 'discord']

    for (const serviceId of serviceIds) {
      const normalized = serviceId.replace(/-/g, '_')
      expect(normalized).toBe(serviceId)
    }
  })
})
