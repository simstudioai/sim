/**
 * @vitest-environment node
 */
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
  McpToolsNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
  resolveVerifiedUserAccessControlContext,
  SkillsNotAllowedError,
  ToolNotAllowedError,
  validateBlockType,
  validateChatDeployAuth,
  validateModelProvider,
  validatePublicFileSharing,
} from './permission-check'

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

  it('governs an external member via the org default group', async () => {
    setEnterpriseOrgWorkspace()
    queueGroupResolution([], [{ config: { disableCustomTools: true } }])

    const config = await getUserPermissionConfig('external-user', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
  })

  it('returns null when no workspace group and no default group apply', async () => {
    setEnterpriseOrgWorkspace()
    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })
})

describe('access control context resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
  })

  it('loads the workspace to find its organization, archived workspaces included', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({ organizationId: null })

    await expect(getUserPermissionConfig('user-123', 'workspace-1')).resolves.toBeNull()
    expect(mockGetWorkspaceWithOwner).toHaveBeenCalledWith('workspace-1', {
      includeArchived: true,
    })
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('resolves the group through the organization the workspace lookup returned', async () => {
    setEnterpriseOrgWorkspace()
    queueGroupResolution([
      { id: 'g', config: { disableMcpTools: true }, isMember: true, hasMembers: true },
    ])

    await expect(getUserPermissionConfig('user-123', 'workspace-1')).resolves.toMatchObject({
      disableMcpTools: true,
    })
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith('org-1', 'throw')
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

  it('describes a personal workspace as unentitled and ungoverned', async () => {
    await expect(
      resolveVerifiedUserAccessControlContext('user-123', 'workspace-1', null)
    ).resolves.toEqual({
      organizationId: null,
      entitled: false,
      permissionGroup: null,
      config: null,
    })
  })

  it('identifies an all-members governing group', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    queueGroupResolution([
      {
        id: 'group-all-members',
        name: 'All workspace members',
        config: { disableCustomTools: true },
        isMember: false,
        hasMembers: false,
      },
    ])

    const context = await resolveVerifiedUserAccessControlContext(
      'user-123',
      'workspace-1',
      'org-1'
    )

    expect(context.permissionGroup).toEqual({
      id: 'group-all-members',
      name: 'All workspace members',
      resolution: 'all-members',
    })
  })

  it('uses a verified workspace organization without loading the workspace again', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    queueGroupResolution([
      {
        id: 'group-verified',
        name: 'Verified group',
        config: { disableSkills: true },
        isMember: true,
        hasMembers: true,
      },
    ])

    const context = await resolveVerifiedUserAccessControlContext(
      'user-123',
      'workspace-1',
      'org-verified'
    )

    expect(mockGetWorkspaceWithOwner).not.toHaveBeenCalled()
    expect(mockIsOrganizationOnEnterprisePlan).toHaveBeenCalledWith('org-verified', 'throw')
    expect(context).toMatchObject({
      organizationId: 'org-verified',
      entitled: true,
      permissionGroup: {
        id: 'group-verified',
        resolution: 'explicit-member',
      },
      config: { disableSkills: true },
    })
  })

  /**
   * The group and the deployment name the same integrations by different
   * vintages — the editor only offers current ids, `ALLOWED_INTEGRATIONS` is
   * hand-written. Intersecting them textually left Slack out of a policy both
   * layers permit, so both sides are successor-resolved first.
   */
  it('identifies the default group and preserves the environment allowlist', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(['slack'])
    queueGroupResolution(
      [],
      [
        {
          id: 'group-default',
          name: 'Organization default',
          config: { allowedIntegrations: ['slack_v2', 'github'] },
        },
      ]
    )

    const context = await resolveVerifiedUserAccessControlContext(
      'user-123',
      'workspace-1',
      'org-1'
    )

    expect(context.permissionGroup).toEqual({
      id: 'group-default',
      name: 'Organization default',
      resolution: 'default',
    })
    expect(context.config?.allowedIntegrations).toEqual(['slack_v2'])
  })
})

describe('getUserPermissionConfig (workspace-group precedence)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('governs an explicit member via their workspace group', async () => {
    queueGroupResolution([
      { id: 'g', config: { disableMcpTools: true }, isMember: true, hasMembers: true },
    ])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableMcpTools).toBe(true)
  })

  it('governs all members (including non-listed) via an all-members group', async () => {
    queueGroupResolution([
      { id: 'g', config: { disableSkills: true }, isMember: false, hasMembers: false },
    ])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config?.disableSkills).toBe(true)
  })

  it('governs an external member via an all-members group', async () => {
    queueGroupResolution([
      { id: 'g', config: { disableCustomTools: true }, isMember: false, hasMembers: false },
    ])

    const config = await getUserPermissionConfig('external-user', 'workspace-1')

    expect(config?.disableCustomTools).toBe(true)
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

  it('a narrowed group does not govern a non-member; unrestricted when no default', async () => {
    queueGroupResolution([
      { id: 'narrowed', config: { disableSkills: true }, isMember: false, hasMembers: true },
    ])

    const config = await getUserPermissionConfig('user-123', 'workspace-1')

    expect(config).toBeNull()
  })
})

describe('validateBlockType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
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

    it('case-folds a stored allowlist so a mixed-case entry still matches', async () => {
      setEnterpriseOrgWorkspace()
      queueGroupResolution([{ config: { allowedIntegrations: ['Slack'] } }])

      await validateBlockType('user-123', 'workspace-1', 'slack')
    })

    /**
     * Registry keys are lowercase, so a mixed-case block type must be folded
     * *before* the successor lookup. Resolving first makes `getBlock('Slack')`
     * miss, the successor answer `Slack`, and the comparison fall back to
     * `slack` — refusing a block the allowlist permits as `slack_v2`.
     */
    it('resolves a superseded block supplied with different casing', async () => {
      setEnterpriseOrgWorkspace()
      mockGetBlock.mockImplementation((type: string) =>
        type === 'slack'
          ? { hideFromToolbar: true, sunset: { status: 'legacy', replacedBy: 'slack_v2' } }
          : type === 'slack_v2'
            ? {}
            : undefined
      )
      queueGroupResolution([{ config: { allowedIntegrations: ['slack_v2'] } }])

      await validateBlockType('user-123', 'workspace-1', 'Slack')
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
    resetDbChainMock()
    mockGetAllowedIntegrationsFromEnv.mockReturnValue(null)
    setEnterpriseOrgWorkspace()
  })

  it('no-ops when user or workspace is missing', async () => {
    await validateModelProvider(undefined, 'workspace-1', 'gpt-4')
    await validateModelProvider('user-123', undefined, 'gpt-4')
  })

  it('throws ProviderNotAllowedError when provider is not in allowlist', async () => {
    queueGroupResolution([{ config: { allowedModelProviders: ['anthropic'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })

  it('allows when provider is on the allowlist', async () => {
    queueGroupResolution([{ config: { allowedModelProviders: ['anthropic', 'openai'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4')
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

  it('allows a model that is not on the denylist', async () => {
    queueGroupResolution([{ config: { deniedModels: ['gpt-4'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await validateModelProvider('user-123', 'workspace-1', 'gpt-4o')
  })

  it('applies the org default group when no workspace group governs the user', async () => {
    queueGroupResolution([], [{ config: { allowedModelProviders: ['anthropic'] } }])
    mockGetProviderFromModel.mockReturnValue('openai')

    await expect(validateModelProvider('user-123', 'workspace-1', 'gpt-4')).rejects.toBeInstanceOf(
      ProviderNotAllowedError
    )
  })
})

describe('assertPermissionsAllowed (MCP tools)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('no-ops when disableMcpTools is false', async () => {
    queueGroupResolution([{ config: {} }])

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      toolKind: 'mcp',
    })
  })
})

describe('validatePublicFileSharing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('allows an auth type that is in the allow-list', async () => {
    queueGroupResolution([{ config: { allowedFileShareAuthTypes: ['password', 'sso'] } }])
    await validatePublicFileSharing('user-123', 'workspace-1', 'password')
  })

  it('allows any auth type when the allow-list is null', async () => {
    queueGroupResolution([{ config: { allowedFileShareAuthTypes: null } }])
    await validatePublicFileSharing('user-123', 'workspace-1', 'email')
  })

  it('no-ops when no auth type is provided (master switch only)', async () => {
    queueGroupResolution([{ config: { allowedFileShareAuthTypes: ['password'] } }])
    await validatePublicFileSharing('user-123', 'workspace-1')
  })

  it('resolves the group once per request scope, not once per assertion', async () => {
    queueGroupResolution([{ config: { allowedFileShareAuthTypes: null } }])

    await withPermissionGroupScope(async () => {
      await validatePublicFileSharing('user-123', 'workspace-1', 'password')
      await validatePublicFileSharing('user-123', 'workspace-1', 'email')
    })

    expect(mockGetWorkspaceWithOwner).toHaveBeenCalledTimes(1)
  })
})

describe('validateChatDeployAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('allows an auth type that is in the allow-list', async () => {
    queueGroupResolution([{ config: { allowedChatDeployAuthTypes: ['password', 'sso'] } }])
    await validateChatDeployAuth('user-123', 'workspace-1', 'password')
  })

  it('allows any auth type when the allow-list is null', async () => {
    queueGroupResolution([{ config: { allowedChatDeployAuthTypes: null } }])
    await validateChatDeployAuth('user-123', 'workspace-1', 'email')
  })

  it('no-ops when access control does not apply (non-enterprise)', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    await validateChatDeployAuth('user-123', 'workspace-1', 'public')
  })
})

describe('assertPermissionsAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('throws ModelNotAllowedError when the model is on the denylist', async () => {
    queueGroupResolution([{ config: { deniedModels: ['gpt-4'] } }])
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
    queueGroupResolution([{ config: { allowedIntegrations: ['slack'] } }])

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        blockType: 'discord',
      })
    ).rejects.toBeInstanceOf(IntegrationNotAllowedError)
  })

  it('exempts legacy blocks from the integration allowlist', async () => {
    queueGroupResolution([{ config: { allowedIntegrations: ['slack'] } }])
    mockGetBlock.mockImplementation((type) =>
      type === 'thinking' ? { hideFromToolbar: true } : undefined
    )

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      blockType: 'thinking',
    })
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

  it('allows a tool that is not on the denylist', async () => {
    queueGroupResolution([{ config: { deniedTools: ['slack_canvas'] } }])

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      toolId: 'slack_message',
    })
  })

  it('allows every tool when the denylist is empty', async () => {
    queueGroupResolution([{ config: { deniedTools: [] } }])

    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      toolId: 'slack_canvas',
    })
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

  it('throws SkillsNotAllowedError when skills are disabled', async () => {
    queueGroupResolution([{ config: { disableSkills: true } }])

    await expect(
      assertPermissionsAllowed({
        userId: 'user-123',
        workspaceId: 'workspace-1',
        toolKind: 'skill',
      })
    ).rejects.toBeInstanceOf(SkillsNotAllowedError)
  })

  it('passes when the workspace has no blocking config', async () => {
    await assertPermissionsAllowed({
      userId: 'user-123',
      workspaceId: 'workspace-1',
      model: 'gpt-4',
      blockType: 'slack',
      toolKind: 'mcp',
    })
  })
})
