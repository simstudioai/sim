/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  blocks: vi.fn(),
  visibility: vi.fn(),
  credentialGroups: vi.fn(),
  allowedIntegrations: vi.fn(),
  blacklistedProviders: vi.fn(),
  integrationAvailable: vi.fn(),
  oauthAvailable: vi.fn(),
  filterModels: vi.fn(),
  toolMetadata: vi.fn(),
}))

vi.mock('@/blocks/registry', () => ({
  getBlockRegistry: mocks.blocks,
  getBlock: (id: string) => mocks.blocks()[id],
}))
vi.mock('@/lib/core/config/block-visibility', () => ({ getBlockVisibility: mocks.visibility }))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.credentialGroups,
}))
vi.mock('@/lib/core/config/env', () => ({ env: { VLLM_BASE_URL: '', LITELLM_BASE_URL: '' } }))
vi.mock('@/lib/core/config/env-flags', () => ({
  getAllowedIntegrationsFromEnv: mocks.allowedIntegrations,
  getBlacklistedProvidersFromEnv: mocks.blacklistedProviders,
  isHosted: true,
  isChatEnabled: false,
  isInboxEnabled: true,
  isInvitationsDisabled: true,
  isPublicApiDisabled: true,
  isSandboxesEnabled: false,
  isSsoEnabled: false,
}))
vi.mock('@/lib/core/utils/urls', () => ({ isOllamaUrlConfigured: () => false }))
vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mocks.integrationAvailable,
  isOAuthServiceDeploymentAvailable: mocks.oauthAvailable,
}))
vi.mock('@/providers/utils', () => ({ filterBlacklistedModels: mocks.filterModels }))
vi.mock('@/tools/metadata', () => ({ getToolMetadata: mocks.toolMetadata }))
vi.mock('@/providers/models', () => {
  const publicModels = {
    openai: [
      { id: 'public-model' },
      { id: 'blocked-model' },
      { id: 'retired-model', sunset: { status: 'deprecated' } },
    ],
    fireworks: [{ id: 'fireworks/public-model' }],
  }
  return {
    getStaticProviderModels: (providerId: string) =>
      publicModels[providerId as keyof typeof publicModels] ?? [],
    PROVIDER_DEFINITIONS: {
      openai: { id: 'openai', name: 'OpenAI', models: publicModels.openai },
      anthropic: { id: 'anthropic', name: 'Anthropic', models: [{ id: 'anthropic-model' }] },
      ollama: { id: 'ollama', name: 'Ollama', models: [{ id: 'private-local' }] },
      vllm: { id: 'vllm', name: 'vLLM', models: [] },
      litellm: { id: 'litellm', name: 'LiteLLM', models: [] },
      openrouter: {
        id: 'openrouter',
        name: 'OpenRouter',
        models: [{ id: 'private-tenant-model' }],
      },
      fireworks: {
        id: 'fireworks',
        name: 'Fireworks',
        models: [...publicModels.fireworks, { id: 'fireworks/private-model' }],
      },
    },
  }
})
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    available: {
      id: 'available',
      name: 'Available connector',
      auth: { mode: 'oauth', provider: 'available' },
    },
    unavailable: {
      id: 'unavailable',
      name: 'Unavailable connector',
      auth: { mode: 'oauth', provider: 'unavailable' },
    },
    token: { id: 'token', name: 'Token connector', auth: { mode: 'apiKey' } },
    fallback: {
      id: 'fallback',
      name: 'Token fallback',
      auth: { mode: 'oauth', provider: 'unavailable', apiKey: { label: 'Token' } },
    },
  },
}))

import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import {
  getAccessRequestDeploymentUnavailableReason,
  listAccessRequestTargets,
  loadAccessRequestCatalog,
} from '@/ee/access-requests/lib/catalog'
import {
  buildAccessRequestPolicyDelta,
  validateAccessRequestTarget,
} from '@/ee/access-requests/lib/targets'

const context = { userId: 'viewer', organizationId: 'org', workspaceId: 'ws' }

describe('access request catalog deployment ceilings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.visibility.mockResolvedValue({
      revealed: new Set(['revealed']),
      disabled: new Set(['killed']),
      previewTagged: new Set(),
    })
    mocks.credentialGroups.mockResolvedValue(false)
    mocks.allowedIntegrations.mockReturnValue(null)
    mocks.blacklistedProviders.mockReturnValue(['anthropic'])
    mocks.integrationAvailable.mockImplementation((id: string) => id !== 'misconfigured')
    mocks.oauthAvailable.mockImplementation((id: string) => id === 'available')
    mocks.filterModels.mockImplementation((models: string[]) =>
      models.filter((id) => id !== 'blocked-model')
    )
    mocks.toolMetadata.mockImplementation((id: string) =>
      id === 'missing' ? undefined : { id, name: id }
    )
    mocks.blocks.mockReturnValue({
      slack_v2: {
        type: 'slack_v2',
        name: 'Slack',
        tools: { access: ['slack_send_message_v2', 'missing'] },
      },
      github_v2: { type: 'github_v2', name: 'GitHub', tools: { access: ['github_create_issue'] } },
      github: {
        type: 'github',
        name: 'Retired GitHub',
        tools: { access: ['retired_github_tool'] },
      },
      hidden: { type: 'hidden', name: 'Hidden', hideFromToolbar: true },
      unrevealed: { type: 'unrevealed', name: 'Unrevealed', preview: true },
      revealed: { type: 'revealed', name: 'Revealed', preview: true },
      killed: { type: 'killed', name: 'Killed' },
      misconfigured: { type: 'misconfigured', name: 'Misconfigured' },
      credential_group: { type: 'credential_group', name: 'Credential Group' },
      custom_block_private: { type: 'custom_block_private', name: 'Secret Customer Name' },
      start_trigger: { type: 'start_trigger', name: 'Start' },
    })
  })

  it('exposes only public visible and deployment-available block/tool metadata', async () => {
    const catalog = await loadAccessRequestCatalog(context)
    expect([...catalog.integrations.keys()]).toEqual([
      'loop',
      'parallel',
      'slack_v2',
      'github_v2',
      'revealed',
    ])
    expect([...catalog.tools.keys()]).toEqual(['slack_send_message_v2', 'github_create_issue'])
    expect(mocks.visibility).toHaveBeenCalledWith({
      userId: 'viewer',
      orgId: 'org',
      workspaceId: 'ws',
    })
    expect(JSON.stringify(listAccessRequestTargets(catalog))).not.toContain('private')
  })

  it.each(['feature', 'usage_limit', 'file_share_auth', 'chat_deploy_auth'] as const)(
    'keeps %s discovery independent of registry and visibility work',
    async (kind) => {
      const catalog = await loadAccessRequestCatalog(context, kind)
      expect(catalog.integrations.size).toBe(0)
      expect(mocks.visibility).not.toHaveBeenCalled()
      expect(mocks.credentialGroups).not.toHaveBeenCalled()
      expect(mocks.blocks).not.toHaveBeenCalled()
      expect(mocks.toolMetadata).not.toHaveBeenCalled()
    }
  )

  it('loads only the relevant catalog family', async () => {
    const integrations = await loadAccessRequestCatalog(context, 'integration')
    expect(integrations.integrations.size).toBeGreaterThan(0)
    expect(integrations.providers.size).toBe(0)
    expect(integrations.tools.size).toBe(0)
    expect(mocks.toolMetadata).not.toHaveBeenCalled()
    mocks.visibility.mockClear()
    const models = await loadAccessRequestCatalog(context, 'model')
    expect(models.models.size).toBeGreaterThan(0)
    expect(models.integrations.size).toBe(0)
    expect(mocks.visibility).not.toHaveBeenCalled()
  })

  it('canonicalizes the deployment integration allowlist before matching', async () => {
    mocks.allowedIntegrations.mockReturnValue(['SLACK'])
    const catalog = await loadAccessRequestCatalog(context)
    expect([...catalog.integrations.keys()]).toEqual(['slack_v2'])
    expect([...catalog.tools.keys()]).toEqual(['slack_send_message_v2'])
    mocks.allowedIntegrations.mockReturnValue([])
    expect((await loadAccessRequestCatalog(context)).integrations.size).toBe(0)
  })

  it('enforces deployment ceilings without removing unrelated stored grants from an approval', async () => {
    mocks.allowedIntegrations.mockReturnValue(['slack'])
    const catalog = await loadAccessRequestCatalog(context, 'integration')
    expect(
      validateAccessRequestTarget({ kind: 'integration', id: 'github_v2' }, catalog)
    ).toBeNull()
    const config = { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: ['github_v2'] }
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'integration', id: 'slack_v2' },
      config,
      catalog
    )
    expect(delta.config.allowedIntegrations).toEqual(['github_v2', 'slack_v2'])
    expect(config.allowedIntegrations).toEqual(['github_v2'])
  })

  it('omits blacklisted/retired models, unconfigured endpoints, and private dynamic names', async () => {
    const catalog = await loadAccessRequestCatalog(context)
    expect([...catalog.providers.keys()]).toEqual(['openai', 'openrouter', 'fireworks'])
    expect([...catalog.models.keys()]).toEqual(['public-model', 'fireworks/public-model'])
    expect([...catalog.knowledgeConnectors.keys()]).toEqual(['available', 'token', 'fallback'])
  })

  it('keeps public models of dynamic providers requestable without exposing private names', async () => {
    const catalog = await loadAccessRequestCatalog(context, 'model')

    expect(catalog.models.get('fireworks/public-model')).toEqual({
      id: 'fireworks/public-model',
      label: 'fireworks/public-model',
      providerId: 'fireworks',
    })
    expect(catalog.models.has('fireworks/private-model')).toBe(false)
    expect(catalog.models.has('private-tenant-model')).toBe(false)
  })

  it('refuses ambiguous tool parent policies instead of choosing one silently', async () => {
    mocks.blocks.mockReturnValue({
      first: { type: 'first', name: 'First', tools: { access: ['shared_tool'] } },
      second: { type: 'second', name: 'Second', tools: { access: ['shared_tool'] } },
    })
    expect((await loadAccessRequestCatalog(context)).tools.has('shared_tool')).toBe(false)
  })

  it('reports deployment flags as unavailable, independently of group config', () => {
    expect(
      getAccessRequestDeploymentUnavailableReason({ kind: 'feature', configKey: 'hideCopilot' })
    ).not.toBeNull()
    expect(
      getAccessRequestDeploymentUnavailableReason({
        kind: 'feature',
        configKey: 'disableInvitations',
      })
    ).not.toBeNull()
    expect(
      getAccessRequestDeploymentUnavailableReason({ kind: 'file_share_auth', id: 'sso' })
    ).not.toBeNull()
    expect(
      getAccessRequestDeploymentUnavailableReason({ kind: 'feature', configKey: 'hideTablesTab' })
    ).toBeNull()
  })

  it('retains genuinely governed core blocks while omitting canonical exemptions', async () => {
    mocks.blocks.mockReturnValue({
      agent: { type: 'agent', name: 'Agent' },
      condition: { type: 'condition', name: 'Condition' },
      thinking: { type: 'thinking', name: 'Retired thinking', hideFromToolbar: true },
      start_trigger: { type: 'start_trigger', name: 'Start' },
    })
    const catalog = await loadAccessRequestCatalog(context)
    expect(isBlockTypeAccessControlExempt('agent')).toBe(false)
    expect(isBlockTypeAccessControlExempt('condition')).toBe(false)
    expect(isBlockTypeAccessControlExempt('thinking')).toBe(true)
    expect(isBlockTypeAccessControlExempt('start_trigger')).toBe(true)
    expect([...catalog.integrations.keys()]).toEqual(['loop', 'parallel', 'agent', 'condition'])
  })
})
