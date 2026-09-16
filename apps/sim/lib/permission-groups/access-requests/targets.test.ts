/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type AccessRequestTarget,
  buildAccessRequestPolicyDelta,
  createAccessRequestCatalog,
  describeAccessRequestTarget,
  getAccessRequestTargetKey,
  isAccessRequestTargetDenied,
  isAccessRequestTargetInScope,
  validateAccessRequestTarget,
} from '@/lib/permission-groups/access-requests/targets'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const catalog = createAccessRequestCatalog({
  integrations: [
    { id: 'slack_v2', label: 'Slack' },
    { id: 'github', label: 'GitHub' },
  ],
  providers: [
    { id: 'openai', label: 'OpenAI' },
    { id: 'anthropic', label: 'Anthropic' },
  ],
  models: [
    { id: 'gpt-example', label: 'Example GPT', providerId: 'openai' },
    { id: 'other-gpt', label: 'Other GPT', providerId: 'openai' },
  ],
  tools: [{ id: 'slack_send_message_v2', label: 'Send message', integrationId: 'slack_v2' }],
  knowledgeConnectors: [{ id: 'google_drive', label: 'Google Drive' }],
})

describe('access request targets', () => {
  it('rejects unknown and prototype-named catalog IDs', () => {
    for (const id of ['__proto__', 'constructor', 'missing']) {
      expect(validateAccessRequestTarget({ kind: 'integration', id }, catalog)).toBeNull()
      expect(validateAccessRequestTarget({ kind: 'provider', id }, catalog)).toBeNull()
      expect(validateAccessRequestTarget({ kind: 'model', id }, catalog)).toBeNull()
      expect(validateAccessRequestTarget({ kind: 'tool', id }, catalog)).toBeNull()
    }
  })

  it('canonicalizes integration successors before testing or keying a request', () => {
    const target = validateAccessRequestTarget({ kind: 'integration', id: 'Slack' }, catalog)
    expect(target).toEqual({ kind: 'integration', id: 'slack_v2' })
    expect(target && getAccessRequestTargetKey(target)).toBe('integration:slack_v2')
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'integration', id: 'slack_v2' },
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: ['SLACK'] },
      catalog
    )
    expect(delta.changes).toEqual([])
  })

  it('allows a single member of an empty allowlist without lifting the whole allowlist', () => {
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'integration', id: 'slack_v2' },
      { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: [] },
      catalog
    )
    expect(delta.config.allowedIntegrations).toEqual(['slack_v2'])
    expect(delta.changes).toEqual([
      {
        configKey: 'allowedIntegrations',
        label: 'Allowed integrations and blocks',
        before: [],
        after: ['slack_v2'],
      },
    ])
    expect(
      buildAccessRequestPolicyDelta(
        { kind: 'integration', id: 'slack_v2' },
        DEFAULT_PERMISSION_GROUP_CONFIG,
        catalog
      ).changes
    ).toEqual([])
  })

  it('shows both provider and model changes while preserving other explicit denials', () => {
    const original = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedModelProviders: ['anthropic'],
      deniedModels: ['GPT-EXAMPLE', 'other-gpt'],
    }
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'model', id: 'GpT-ExAmPlE' },
      original,
      catalog
    )
    expect(delta.config.allowedModelProviders).toEqual(['anthropic', 'openai'])
    expect(delta.config.deniedModels).toEqual(['other-gpt'])
    expect(delta.changes.map((change) => change.configKey)).toEqual([
      'allowedModelProviders',
      'deniedModels',
    ])
    expect(original.allowedModelProviders).toEqual(['anthropic'])
    expect(original.deniedModels).toEqual(['GPT-EXAMPLE', 'other-gpt'])
  })

  it('keeps model denials when requesting a provider', () => {
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'provider', id: 'openai' },
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        allowedModelProviders: [],
        deniedModels: ['gpt-example'],
      },
      catalog
    )
    expect(delta.config.deniedModels).toEqual(['gpt-example'])
    expect(delta.changes.map((change) => change.configKey)).toEqual(['allowedModelProviders'])
  })

  it('shows the tool and parent integration changes using exact tool IDs', () => {
    const config = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      allowedIntegrations: ['github'],
      deniedTools: ['slack_send_message_v2', 'other_tool'],
    }
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'tool', id: 'slack_send_message_v2' },
      config,
      catalog
    )
    expect(delta.config.allowedIntegrations).toEqual(['github_v2', 'slack_v2'])
    expect(delta.config.deniedTools).toEqual(['other_tool'])
    expect(delta.changes.map((change) => change.configKey)).toEqual([
      'allowedIntegrations',
      'deniedTools',
    ])
    expect(
      validateAccessRequestTarget({ kind: 'tool', id: 'SLACK_SEND_MESSAGE_V2' }, catalog)
    ).toBeNull()
  })

  it('opens the parent module for a child action and preserves other child restrictions', () => {
    const config = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideKnowledgeBaseTab: true,
      disableKnowledgeBaseCreation: true,
      disableKnowledgeBaseExport: true,
    }
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'feature', configKey: 'disableKnowledgeBaseCreation' },
      config,
      catalog
    )
    expect(CAPABILITY_RULES['knowledge.create'].deniedBy(delta.config)).toBe(false)
    expect(CAPABILITY_RULES['knowledge.export'].deniedBy(delta.config)).toBe(true)
    expect(delta.changes.map((change) => change.configKey)).toEqual([
      'hideKnowledgeBaseTab',
      'disableKnowledgeBaseCreation',
    ])
  })

  it('lifts both the connector allowlist and the module restriction', () => {
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'knowledge_connector', id: 'google_drive' },
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideKnowledgeBaseTab: true,
        allowedKnowledgeConnectors: [],
      },
      catalog
    )
    expect(CAPABILITY_RULES['knowledge.use'].deniedBy(delta.config)).toBe(false)
    expect(CAPABILITY_RULES['knowledge.connectors'].deniedBy(delta.config, 'google_drive')).toBe(
      false
    )
    expect(delta.config.allowedKnowledgeConnectors).toEqual(['google_drive'])
  })

  it('includes parent sharing/module restrictions when allowing one authentication mode', () => {
    const delta = buildAccessRequestPolicyDelta(
      { kind: 'file_share_auth', id: 'sso' },
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideFilesTab: true,
        disablePublicFileSharing: true,
        allowedFileShareAuthTypes: ['password'],
      },
      catalog
    )
    expect(delta.config.allowedFileShareAuthTypes).toEqual(['password', 'sso'])
    expect(delta.changes.map((change) => change.configKey)).toEqual([
      'hideFilesTab',
      'disablePublicFileSharing',
      'allowedFileShareAuthTypes',
    ])
  })

  it('identifies organization-only targets and keeps billing out of policy mutation', () => {
    expect(
      isAccessRequestTargetInScope(
        { kind: 'feature', configKey: 'disableWorkspaceCreation' },
        { kind: 'workspace', workspaceId: 'ws' },
        catalog
      )
    ).toBe(false)
    expect(
      isAccessRequestTargetInScope(
        { kind: 'feature', configKey: 'disableCliAccess' },
        { kind: 'organization', organizationId: 'org' },
        catalog
      )
    ).toBe(true)
    expect(describeAccessRequestTarget({ kind: 'usage_limit', id: 'member' }, catalog)?.scope).toBe(
      'workspace-or-organization'
    )
    for (const scope of [
      { kind: 'workspace', workspaceId: 'ws' },
      { kind: 'organization', organizationId: 'org' },
    ] as const) {
      expect(
        isAccessRequestTargetInScope({ kind: 'usage_limit', id: 'member' }, scope, catalog)
      ).toBe(true)
    }
    expect(() =>
      buildAccessRequestPolicyDelta(
        { kind: 'usage_limit', id: 'member' },
        DEFAULT_PERMISSION_GROUP_CONFIG,
        catalog
      )
    ).toThrow('billing limit change')
  })

  it('includes module and upload blockers for built-in tool requests', () => {
    const moduleCatalog = createAccessRequestCatalog({
      integrations: [
        { id: 'mcp', label: 'MCP' },
        { id: 'knowledge', label: 'Knowledge' },
        { id: 'table_v2', label: 'Tables' },
      ],
      providers: [],
      models: [],
      knowledgeConnectors: [],
      tools: [
        { id: 'mcp_run_operation', label: 'Run MCP operation', integrationId: 'mcp' },
        { id: 'knowledge_create_document', label: 'Create document', integrationId: 'knowledge' },
      ],
    })
    const config = {
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableMcpTools: true,
      hideKnowledgeBaseTab: true,
      disableKnowledgeBaseFileUpload: true,
      hideTablesTab: true,
    }
    const mcp = buildAccessRequestPolicyDelta(
      { kind: 'tool', id: 'mcp_run_operation' },
      config,
      moduleCatalog
    )
    expect(mcp.changes.map((change) => change.configKey)).toEqual(['disableMcpTools'])
    const upload = buildAccessRequestPolicyDelta(
      { kind: 'tool', id: 'knowledge_create_document' },
      config,
      moduleCatalog
    )
    expect(upload.changes.map((change) => change.configKey)).toEqual([
      'hideKnowledgeBaseTab',
      'disableKnowledgeBaseFileUpload',
    ])
    const table = buildAccessRequestPolicyDelta(
      { kind: 'integration', id: 'table_v2' },
      config,
      moduleCatalog
    )
    expect(table.changes.map((change) => change.configKey)).toEqual(['hideTablesTab'])
    for (const delta of [mcp, upload, table]) {
      expect(isAccessRequestTargetDenied(delta.target, config, moduleCatalog)).toBe(true)
      expect(isAccessRequestTargetDenied(delta.target, delta.config, moduleCatalog)).toBe(false)
    }
  })

  it('keeps cheap discovery denial in parity with full policy deltas', () => {
    const targets: AccessRequestTarget[] = [
      { kind: 'feature', configKey: 'disableKnowledgeBaseCreation' },
      { kind: 'integration', id: 'slack' },
      { kind: 'provider', id: 'openai' },
      { kind: 'model', id: 'GPT-EXAMPLE' },
      { kind: 'tool', id: 'slack_send_message_v2' },
      { kind: 'knowledge_connector', id: 'google_drive' },
      { kind: 'file_share_auth', id: 'public' },
      { kind: 'chat_deploy_auth', id: 'sso' },
    ]
    const configs = [
      DEFAULT_PERMISSION_GROUP_CONFIG,
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        allowedIntegrations: ['SLACK'],
        allowedModelProviders: ['openai'],
        deniedModels: ['OTHER-GPT'],
      },
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideKnowledgeBaseTab: true,
        hideFilesTab: true,
        hideDeployChatbot: true,
      },
      {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        allowedIntegrations: [],
        allowedModelProviders: [],
        deniedModels: ['GPT-EXAMPLE'],
        deniedTools: ['slack_send_message_v2'],
        allowedKnowledgeConnectors: [],
        allowedFileShareAuthTypes: [],
        allowedChatDeployAuthTypes: [],
      },
    ]
    for (const config of configs) {
      for (const target of targets) {
        expect(isAccessRequestTargetDenied(target, config, catalog)).toBe(
          buildAccessRequestPolicyDelta(target, config, catalog).changes.length > 0
        )
      }
    }
  })

  it('permits read-level module requests for secrets and API-key visibility', () => {
    expect(
      describeAccessRequestTarget({ kind: 'feature', configKey: 'hideSecretsTab' }, catalog)
        ?.minimumRole
    ).toBe('read')
    expect(
      describeAccessRequestTarget({ kind: 'feature', configKey: 'hideApiKeysTab' }, catalog)
        ?.minimumRole
    ).toBe('read')
  })
})
