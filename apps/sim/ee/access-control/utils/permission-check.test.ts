import { db } from '@sim/db'
import { permissionGroup } from '@sim/db/schema'
import {
  envFlagsMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'

const { mockIsOrganizationOnEnterprisePlan, mockGetWorkspaceWithOwner, mockGetProviderFromModel } =
  vi.hoisted(() => ({
    mockIsOrganizationOnEnterprisePlan: vi.fn<() => Promise<boolean>>(),
    mockGetWorkspaceWithOwner: vi.fn<() => Promise<{ organizationId: string | null } | null>>(),
    mockGetProviderFromModel: vi.fn<(model: string) => string>(),
  }))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
  /**
   * The same knob drives both: these tests ask whether the organization is entitled at all, and
   * permission resolution reads the governance axis, which only differs from the feature gate
   * while a payment is failing.
   */
  isOrganizationGovernanceActive: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))

vi.mock('@/providers/utils', () => ({
  isFunctionToolCall: (toolCall: unknown) =>
    typeof toolCall === 'object' &&
    toolCall !== null &&
    'function' in toolCall &&
    (toolCall as { function?: unknown }).function != null,
  getProviderFromModel: mockGetProviderFromModel,
}))

import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  assertPermissionsAllowed,
  CustomToolsNotAllowedError,
  getUserPermissionConfig,
  IntegrationNotAllowedError,
  InvitationsNotAllowedError,
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  resolveVerifiedUserAccessControlContext,
  ToolNotAllowedError,
  validateBlockType,
  validateChatDeployAuth,
  validateInvitationsAllowed,
  validateModelProvider,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'

/** Default an org-backed, enterprise-entitled workspace so resolution reaches the group queries. */
function setEnterpriseOrgWorkspace() {
  mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: 'org-1' })
  mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
}

interface WorkspaceGroupRow {
  id?: string
  name?: string
  config: Record<string, unknown>
  isMember?: boolean
  hasMembers?: boolean
}

/**
 * Queue one group-resolution pass. resolveWorkspaceGroup selects non-default
 * groups targeting the workspace first (FROM permissionGroup INNER JOIN
 * permissionGroupWorkspace, awaited at `orderBy`); each row carries
 * `isMember`/`hasMembers` booleans, and a row with neither flag set reads as
 * an all-members group. Only when no workspace group wins does
 * resolveDefaultGroup select the org default (also FROM permissionGroup, with
 * `limit(1)`). Both selects read the same table, so the queue holds the
 * workspace-group set first and the default-group set second.
 */
function queueGroupResolution(
  workspaceGroups: WorkspaceGroupRow[] = [],
  defaultGroup: Array<{ config: Record<string, unknown> }> = []
) {
  /** Every row carries the column default the resolver reads, as a real row would. */
  queueTableRows(
    permissionGroup,
    workspaceGroups.map((row) => ({ membershipMode: 'inherit', ...row }))
  )
  queueTableRows(permissionGroup, defaultGroup)
}

afterAll(resetDbChainMock)

/** The global registry mock's getBlock, driven per-test in this suite. */
const mockGetBlock = getBlock as Mock

const defaultGetBlockImpl = mockGetBlock.getMockImplementation()

afterAll(() => {
  mockGetBlock.mockImplementation(defaultGetBlockImpl as () => unknown)
})

/**
 * Default every block to non-legacy. `vi.clearAllMocks()` (used by the
 * describe-level hooks) keeps implementations, so reset here to stop a legacy
 * `getBlock` implementation set in one test from leaking into later ones.
 */
beforeEach(() => {
  mockGetBlock.mockImplementation(() => undefined)
})

const mockGetAllowedIntegrationsFromEnv = envFlagsMockFns.getAllowedIntegrationsFromEnv

beforeAll(() => {
  setEnvFlags({ isAccessControlEnabled: true, isHosted: true })
})

afterAll(resetEnvFlagsMock)

describe('getUserPermissionConfig (org + entitlement gating)', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
  })

  it('returns null when the workspace has no organization', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: null })

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  /**
   * The env list is written by hand against whatever ids its author knew, so it
   * is canonicalized on the way in: `slack` and `slack_v2` are the same policy,
   * and the merged config carries the id every gate resolves a block type to.
   */
  it('still applies the env allowlist on a no-org workspace', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: null })
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack'])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.allowedIntegrations).toEqual(['slack_v2'])
  })

  it('returns null when the organization is not on an enterprise plan', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: 'org-1' })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })

  it('falls back to the org default group when no workspace group governs the user', async () => {
    setEnterpriseOrgWorkspace()
    queueGroupResolution([], [{ config: { disableSkills: true } }])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })
})

describe('access control context resolution', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
  })

  it('returns the explicit governing group and its effective config', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    queueGroupResolution([
      {
        id: 'group-explicit',
        name: 'Engineering',
        config: { disableMcpTools: true },
        isMember: true,
        hasMembers: true,
      },
    ])

    await expect(
      resolveVerifiedUserAccessControlContext('user-123', 'workspace-1', 'org-1')
    ).resolves.toEqual({
      organizationId: 'org-1',
      entitled: true,
      permissionGroup: {
        id: 'group-explicit',
        name: 'Engineering',
        resolution: 'explicit-member',
      },
      config: expect.objectContaining({ disableMcpTools: true }),
    })
  })
})

describe('getUserPermissionConfig (workspace-group precedence)', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('governs all members (including non-listed) via an all-members group', async () => {
    queueGroupResolution([
      { id: 'g', config: { disableSkills: true }, isMember: false, hasMembers: false },
    ])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })

  it('prefers an explicit-member group over an all-members group on the same workspace', async () => {
    queueGroupResolution([
      { id: 'all', config: { disableMcpTools: true }, isMember: false, hasMembers: false },
      { id: 'explicit', config: { disableSkills: true }, isMember: true, hasMembers: true },
    ])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
    expect(config?.disableMcpTools).toBe(false)
  })

  it('a narrowed group (has members) does not govern a non-member; falls back to default', async () => {
    queueGroupResolution(
      [{ id: 'narrowed', config: { disableSkills: true }, isMember: false, hasMembers: true }],
      [{ config: { disableCustomTools: true } }]
    )

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
    expect(config?.disableSkills).toBe(false)
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  describe('when no env allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    })

    it('case-folds a stored allowlist so a mixed-case entry still matches', async () => {
      setEnterpriseOrgWorkspace()
      queueGroupResolution([{ config: { allowedIntegrations: ['Slack'] } }])

      await validateBlockType('user-123', 'workspace-1', 'slack')
    })

    it('still rejects a block absent from a mixed-case stored allowlist', async () => {
      setEnterpriseOrgWorkspace()
      queueGroupResolution([{ config: { allowedIntegrations: ['Slack'] } }])

      await expect(validateBlockType('user-123', 'workspace-1', 'discord')).rejects.toThrow(
        IntegrationNotAllowedError
      )
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

    it('rejects block types not on the allowlist', async () => {
      await expect(validateBlockType(undefined, undefined, 'discord')).rejects.toThrow(
        IntegrationNotAllowedError
      )
    })

    it('always allows start_trigger regardless of allowlist', async () => {
      await validateBlockType(undefined, undefined, 'start_trigger')
    })

    /**
     * `thinking` is a real retired block with no successor: it has no editor row
     * and nothing to be permitted *as*, so it is exempt. A retired block that
     * does have one — `notion` — is judged as `notion_v2` instead and is not.
     */
    it('always allows legacy blocks hidden from the toolbar', async () => {
      mockGetBlock.mockImplementation((type) =>
        type === 'thinking' ? { hideFromToolbar: true } : undefined
      )

      await validateBlockType(undefined, undefined, 'thinking')
    })

    it('does NOT treat preview blocks as exempt — preview is not legacy', async () => {
      // A `preview: true` block has static hideFromToolbar unset, so it is a
      // normal access-controlled block: visibility gating (discovery) and
      // permission-group enforcement (execution) are deliberately independent.
      mockGetBlock.mockImplementation((type) =>
        type === 'gmail_v2' ? ({ preview: true } as { hideFromToolbar?: boolean }) : undefined
      )

      await expect(validateBlockType(undefined, undefined, 'gmail_v2')).rejects.toThrow(
        IntegrationNotAllowedError
      )
    })
  })
})

describe('validateModelProvider', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws ProviderNotAllowedError when provider is not in allowlist', async () => {
    queueGroupResolution([{ config: { allowedModelProviders: ['anthropic'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })

  it('throws ModelNotAllowedError when the model is on the denylist', async () => {
    queueGroupResolution([{ config: { deniedModels: ['gpt-4'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })

  it('denylist match is case-insensitive', async () => {
    queueGroupResolution([{ config: { deniedModels: ['Ollama/Llama3'] } }])
    mockGetProviderFromModel.mockReturnValue('ollama')

    await expect(
      validateModelProvider('user-123', 'workspace-1', 'ollama/llama3')
    ).rejects.toBeInstanceOf(ModelNotAllowedError)
  })

  it('enforces the denylist even when no provider allowlist is set', async () => {
    queueGroupResolution([{ config: { allowedModelProviders: null, deniedModels: ['gpt-4'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ModelNotAllowedError
    )
  })
})

describe('assertPermissionsAllowed (MCP tools)', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws McpToolsNotAllowedError when disableMcpTools is set', async () => {
    queueGroupResolution([{ config: { disableMcpTools: true } }])

    await expect(
      assertPermissionsAllowed({ userId: 'user-123', workspaceId: 'workspace-1', toolKind: 'mcp' })
    ).rejects.toBeInstanceOf(McpToolsNotAllowedError)
  })
})

describe('validatePublicFileSharing', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws when public file sharing is fully disabled', async () => {
    queueGroupResolution([{ config: { disablePublicFileSharing: true } }])
    await expect(
      validatePublicFileSharing('user-123', 'workspace-1', 'password')
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })

  it('throws when the auth type is not in the allow-list', async () => {
    queueGroupResolution([{ config: { allowedFileShareAuthTypes: ['password', 'sso'] } }])
    await expect(
      validatePublicFileSharing('user-123', 'workspace-1', 'public')
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })
})

describe('validateChatDeployAuth', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws when the auth type is not in the allow-list', async () => {
    queueGroupResolution([{ config: { allowedChatDeployAuthTypes: ['password', 'sso'] } }])
    await expect(
      validateChatDeployAuth('user-123', 'workspace-1', 'public')
    ).rejects.toBeInstanceOf(PermissionGroupCapabilityError)
  })
})

describe('assertPermissionsAllowed', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('throws ProviderNotAllowedError when model provider is blocked', async () => {
    queueGroupResolution([{ config: { allowedModelProviders: ['anthropic'] } }])
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
    queueGroupResolution([{ config: { allowedIntegrations: ['slack'] } }])

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'discord',
      })
    ).rejects.toBeInstanceOf(IntegrationNotAllowedError)
  })

  it('throws ToolNotAllowedError when the tool is on the denylist', async () => {
    queueGroupResolution([{ config: { deniedTools: ['slack_canvas'] } }])

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolId: 'slack_canvas',
      })
    ).rejects.toBeInstanceOf(ToolNotAllowedError)
  })

  it('denies a tool even when its block is allowed by the integration allowlist', async () => {
    queueGroupResolution([
      { config: { allowedIntegrations: ['slack'], deniedTools: ['slack_canvas'] } },
    ])

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
    queueGroupResolution([{ config: { deniedTools: ['slack_canvas'] } }])
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
    queueGroupResolution([{ config: { disableCustomTools: true } }])

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'custom',
      })
    ).rejects.toBeInstanceOf(CustomToolsNotAllowedError)
  })
})

describe('transactional invitation permission checks', () => {
  beforeEach(() => {
    resetDbChainMock()
    setEnvFlags({ isAccessControlEnabled: true, isHosted: true, isInvitationsDisabled: false })
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('bypasses a cached allow decision when the transaction sees a newly restricted workspace', async () => {
    await withPermissionGroupScope(async () => {
      queueGroupResolution([], [{ config: { disableInvitations: false } }])
      await validateInvitationsAllowed('actor', { workspaceId: 'workspace-1' })
      queueGroupResolution([], [{ config: { disableInvitations: true } }])
      await expect(
        validateInvitationsAllowed('actor', { workspaceId: 'workspace-1' }, db)
      ).rejects.toBeInstanceOf(InvitationsNotAllowedError)
    })
    expect(mockGetWorkspaceWithOwner).toHaveBeenLastCalledWith('workspace-1', {
      includeArchived: true,
      executor: db,
    })
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenLastCalledWith('org-1', db)
  })

  it('resolves organization admission on the transaction executor', async () => {
    queueTableRows(permissionGroup, [{ config: { disableInvitations: true } }])
    await expect(
      validateInvitationsAllowed('actor', { organizationId: 'org-1' }, db)
    ).rejects.toBeInstanceOf(InvitationsNotAllowedError)
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith('org-1', db)
  })
})
