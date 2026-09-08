/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_SANDBOX_CLI_TOOLS,
  SANDBOX_CLI_TOOLS,
  SANDBOX_SELECTABLE_CLI_TOOL_IDS,
} from '@/lib/execution/remote-sandbox/cli-tools'
import type { BlockConfig } from '@/blocks/types'
import { hostedKeyEnabledWhen } from '@/tools/hosting'
import type { ToolConfig } from '@/tools/types'
import {
  buildOrganizationReadme,
  serializeAccessControl,
  serializeAccountBilling,
  serializeAccountMembers,
  serializeAccountWorkspace,
  serializeAccountWorkspaces,
  serializeApiKeyIntegrations,
  serializeBlockSchema,
  serializeConnectedAccounts,
  serializeConnectors,
  serializeCredentials,
  serializeDeployments,
  serializeFileMeta,
  serializeIntegrationSchema,
  serializeKBMeta,
  serializeOrganization,
  serializeOrganizationCustomBlocks,
  serializeOrganizationWorkspaces,
  serializeOrgCustomBlockDetail,
  serializePermissionGroupRoster,
  serializeSandbox,
  serializeSandboxCatalog,
  serializeTableMeta,
  serializeWorkflowMeta,
  serializeWorkspaceForks,
} from './serializers'

function hostedTool(id: string, conditional = false): ToolConfig {
  return {
    id,
    name: id,
    description: `Run ${id}`,
    version: '1.0.0',
    params: {
      provider: { type: 'string', required: conditional },
      apiKey: { type: 'string', required: true, visibility: 'user-only' },
    },
    request: {
      url: 'https://example.com',
      method: 'POST',
      headers: () => ({}),
    },
    hosting: {
      enabled: conditional
        ? hostedKeyEnabledWhen({ field: 'provider', operator: 'equals', value: 'hosted' })
        : undefined,
      envKeyPrefix: 'EXAMPLE_API_KEY',
      apiKeyParam: 'apiKey',
      byokProviderId: 'exa',
      pricing: { type: 'per_request', cost: 0.01 },
      rateLimit: { mode: 'per_request', requestsPerMinute: 10 },
    },
  }
}

describe('VFS metadata serializers', () => {
  it('serializes an undeployed API explicitly instead of as an empty object', () => {
    const deployment = JSON.parse(
      serializeDeployments({
        workflowId: 'workflow-1',
        isDeployed: false,
        mcp: [],
        versions: [],
      })
    )

    expect(deployment).toEqual({ api: { isDeployed: false } })
  })

  it('includes the authoritative file update timestamp', () => {
    const metadata = JSON.parse(
      serializeFileMeta({
        id: 'file-1',
        name: 'notes.md',
        contentType: 'text/markdown',
        size: 42,
        uploadedAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T12:34:56.000Z'),
      })
    )

    expect(metadata.updatedAt).toBe('2026-07-09T12:34:56.000Z')
  })

  it('preserves live table and knowledge-base counts', () => {
    const table = JSON.parse(
      serializeTableMeta({
        id: 'table-1',
        name: 'Customers',
        schema: { columns: [] },
        rowCount: 137,
        maxRows: 10_000,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T00:00:00.000Z'),
      })
    )
    const knowledgeBase = JSON.parse(
      serializeKBMeta({
        id: 'kb-1',
        name: 'Handbook',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        tokenCount: 12_345,
        documentCount: 19,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-09T00:00:00.000Z'),
      })
    )

    expect(table.rowCount).toBe(137)
    expect(knowledgeBase.documentCount).toBe(19)
  })

  it('never includes a workflow description in workflow metadata', () => {
    const workflowWithPrivateDescription = {
      id: 'workflow-1',
      name: 'Private Flow',
      description: 'PRIVATE WORKFLOW DESCRIPTION',
      folderId: null,
      isDeployed: false,
      deployedAt: null,
      runCount: 0,
      lastRunAt: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    }

    const metadata = JSON.parse(serializeWorkflowMeta(workflowWithPrivateDescription))

    expect(metadata).not.toHaveProperty('description')
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE WORKFLOW DESCRIPTION')
  })

  it('serializes the complete Sim sandbox discovery resource', () => {
    const serialized = JSON.parse(
      serializeSandbox(
        {
          id: 'sandbox-1',
          name: 'Data Tools',
          language: 'python',
          dependencies: ['pandas'],
          systemPackages: ['graphviz'],
          cliTools: ['kubectl@1.36.3-r1'],
          buildStatus: 'ready',
          errorCode: null,
          errorMessage: null,
          errorDetail: null,
          builtAt: '2026-08-04T12:00:00.000Z',
          createdAt: '2026-08-04T11:00:00.000Z',
          updatedAt: '2026-08-04T12:00:00.000Z',
        },
        'prebuilt'
      )
    )

    expect(serialized).toMatchObject({
      id: 'sandbox-1',
      strategy: 'prebuilt',
      buildStatus: 'ready',
      dependencies: ['pandas'],
      systemPackages: ['graphviz'],
      cliTools: ['kubectl@1.36.3-r1'],
    })
  })

  it('generates the sandbox capability reference from the authoritative CLI registry', () => {
    const reference = serializeSandboxCatalog('prebuilt')

    expect(reference).toContain('Active dependency strategy: `prebuilt`')
    expect(reference).toContain(`accepts at most ${MAX_SANDBOX_CLI_TOOLS} exact pinned ids`)
    for (const id of SANDBOX_SELECTABLE_CLI_TOOL_IDS) {
      const tool = SANDBOX_CLI_TOOLS[id]
      expect(reference).toContain(`\`${id}\``)
      expect(reference).toContain(tool.label)
      expect(reference).toContain(tool.description)
    }
  })
})

describe('entitlement-projected block schemas', () => {
  it('keeps a gated input readable while marking it unavailable for mutation', () => {
    const block = {
      type: 'function',
      name: 'Function',
      description: 'Run code',
      category: 'blocks',
      bgColor: '#000000',
      icon: () => null,
      subBlocks: [
        { id: 'code', title: 'Code', type: 'long-input' },
        { id: 'sandboxId', title: 'Sandbox', type: 'combobox' },
      ],
      tools: { access: [] },
      inputs: {
        code: { type: 'string' },
        sandboxId: { type: 'string' },
      },
      outputs: {},
    } as unknown as BlockConfig

    const schema = JSON.parse(
      serializeBlockSchema(block, {
        restrictedInputs: new Map([
          [
            'sandboxId',
            {
              requiredEntitlement: 'sim-sandboxes',
              reason: 'Requires an active Max or Enterprise plan.',
            },
          ],
        ]),
      })
    )

    expect(schema.subBlocks.map((subBlock: { id: string }) => subBlock.id)).toEqual([
      'code',
      'sandboxId',
    ])
    expect(schema.subBlocks[1]).toMatchObject({
      readOnly: true,
      requiredEntitlement: 'sim-sandboxes',
      restrictionReason: 'Requires an active Max or Enterprise plan.',
    })
    expect(schema.inputs).toHaveProperty('code')
    expect(schema.inputs.sandboxId).toMatchObject({
      type: 'string',
      readOnly: true,
      requiredEntitlement: 'sim-sandboxes',
      restrictionReason: 'Requires an active Max or Enterprise plan.',
    })
  })
})

describe('hosted-key VFS metadata', () => {
  it('preserves multi-select dropdown behavior in block schemas', () => {
    const block = {
      type: 'events',
      name: 'Events',
      subBlocks: [{ id: 'eventTypes', type: 'dropdown', multiSelect: true }],
      tools: { access: [] },
      inputs: {},
      outputs: {},
    } as unknown as BlockConfig

    const schema = JSON.parse(serializeBlockSchema(block))
    expect(schema.subBlocks[0].multiSelect).toBe(true)
  })

  it('indexes hosted and conditional-hosted operations for every configured service', () => {
    const metadata = JSON.parse(
      serializeApiKeyIntegrations(
        [
          { config: hostedTool('search'), service: 'generic_search', operation: 'search' },
          {
            config: hostedTool('generate', true),
            service: 'generic_search',
            operation: 'generate',
          },
        ],
        true
      )
    )

    expect(metadata.generic_search).toEqual({
      params: ['apiKey'],
      operations: ['search', 'generate'],
      hostedOperations: ['search'],
      conditionalHostedOperations: ['generate'],
    })
  })

  it('marks an operation as hosted and omits only its managed API-key param', () => {
    const schema = JSON.parse(serializeIntegrationSchema(hostedTool('search'), { hosted: true }))

    expect(schema.auth).toEqual({
      type: 'api_key',
      param: 'apiKey',
      mode: 'hosted_or_byok',
      provider: 'exa',
    })
    expect(schema.params).not.toHaveProperty('apiKey')
  })

  it('keeps the API-key param and publishes the exact condition for conditional hosting', () => {
    const schema = JSON.parse(
      serializeIntegrationSchema(hostedTool('generate', true), { hosted: true })
    )

    expect(schema.auth).toEqual({
      type: 'api_key',
      param: 'apiKey',
      mode: 'conditional_hosted_or_byok',
      provider: 'exa',
      condition: { field: 'provider', operator: 'equals', value: 'hosted' },
    })
    expect(schema.params.apiKey).toBeDefined()
  })

  it('marks the same operation as BYOK-required outside hosted Sim', () => {
    const schema = JSON.parse(serializeIntegrationSchema(hostedTool('search'), { hosted: false }))

    expect(schema.auth.mode).toBe('byok_required')
    expect(schema.params.apiKey).toBeDefined()
  })

  it('preserves a visible duplicate API-key field for mixed-operation blocks', () => {
    const block = {
      type: 'mixed_search',
      name: 'Mixed Search',
      description: 'Search or research',
      category: 'tools',
      bgColor: '#000000',
      icon: () => null,
      subBlocks: [
        {
          id: 'operation',
          title: 'Operation',
          type: 'dropdown',
          options: [
            { label: 'Hosted search', id: 'search' },
            { label: 'Research with BYOK', id: 'research' },
          ],
        },
        {
          id: 'apiKey',
          title: 'API Key',
          type: 'short-input',
          hideWhenHosted: true,
          condition: { field: 'operation', value: 'search' },
        },
        {
          id: 'apiKey',
          title: 'API Key',
          type: 'short-input',
          condition: { field: 'operation', value: 'research' },
        },
      ],
      tools: { access: ['search'] },
      inputs: { operation: { type: 'string' }, apiKey: { type: 'string' } },
      outputs: {},
    } as unknown as BlockConfig
    const schema = JSON.parse(
      serializeBlockSchema(block, {
        hosted: true,
        toolConfigs: new Map([['search', hostedTool('search')]]),
      })
    )

    expect(schema.subBlocks.filter((subBlock: { id: string }) => subBlock.id === 'apiKey')).toEqual(
      [expect.objectContaining({ condition: { field: 'operation', value: 'research' } })]
    )
    expect(schema.inputs.apiKey).toBeDefined()
    expect(schema.toolAuth.search.mode).toBe('hosted_or_byok')
  })

  it('omits server-only lifecycle inputs from block schemas', () => {
    const block = {
      type: 'mothership',
      name: 'Sim Chat',
      description: 'Talk to Sim',
      category: 'blocks',
      bgColor: '#000000',
      icon: () => null,
      subBlocks: [
        { id: 'prompt', title: 'Prompt', type: 'long-input' },
        {
          id: 'secretScope',
          title: 'Secret access',
          type: 'dropdown',
          hideFromCopilot: true,
        },
        {
          id: 'mountedSecrets',
          title: 'Secrets',
          type: 'dropdown',
          hideFromCopilot: true,
        },
      ],
      tools: { access: [] },
      inputs: {
        prompt: { type: 'string' },
        secretScope: { type: 'string' },
        mountedSecrets: { type: 'json' },
      },
      outputs: {},
    } as unknown as BlockConfig

    const schema = JSON.parse(serializeBlockSchema(block))

    expect(schema.subBlocks.map((subBlock: { id: string }) => subBlock.id)).toEqual(['prompt'])
    expect(schema.inputs).toEqual({ prompt: { type: 'string' } })
  })
})

describe('serializeBlockSchema permission-group gating', () => {
  const slackBlock = {
    type: 'slack',
    name: 'Slack',
    description: 'Slack',
    category: 'tools',
    subBlocks: [
      {
        id: 'operation',
        title: 'Operation',
        type: 'dropdown',
        options: [
          { label: 'Send Message', id: 'send' },
          { label: 'Create Canvas', id: 'canvas' },
        ],
      },
    ],
    tools: { access: ['slack_message', 'slack_canvas'] },
    inputs: {},
    outputs: {},
  } as unknown as BlockConfig

  it('publishes every operation and tool when nothing is denied', () => {
    const schema = JSON.parse(serializeBlockSchema(slackBlock))

    expect(schema.tools).toEqual(['slack_message', 'slack_canvas'])
    expect(schema.subBlocks[0].options.map((option: { id: string }) => option.id)).toEqual([
      'send',
      'canvas',
    ])
  })

  it('withholds denied operations and tool ids from the viewer schema', () => {
    const schema = JSON.parse(
      serializeBlockSchema(slackBlock, {
        deniedOperationIds: new Set(['canvas']),
        isToolAllowed: (toolId: string) => toolId !== 'slack_canvas',
      })
    )

    expect(schema.tools).toEqual(['slack_message'])
    expect(schema.subBlocks[0].options).toEqual([{ label: 'Send Message', id: 'send' }])
  })

  it('leaves the shared registry options array untouched', () => {
    serializeBlockSchema(slackBlock, { deniedOperationIds: new Set(['canvas']) })

    expect(slackBlock.subBlocks[0].options).toHaveLength(2)
  })
})

describe('serializeKBMeta', () => {
  const baseKb = {
    id: 'kb-1',
    name: 'Support Docs',
    description: null,
    embeddingModel: 'text-embedding-3-small',
    embeddingDimension: 1536,
    tokenCount: 42,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    documentCount: 3,
  }

  it('includes tag definitions when present', () => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [
          { tagName: 'Important', tagSlot: 'tag1', fieldType: 'text' },
          { tagName: 'Department', tagSlot: 'tag2', fieldType: 'text' },
        ],
      })
    )

    const textOperators = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with']
    expect(json.tagDefinitions).toEqual([
      { tagName: 'Important', tagSlot: 'tag1', fieldType: 'text', operators: textOperators },
      { tagName: 'Department', tagSlot: 'tag2', fieldType: 'text', operators: textOperators },
    ])
  })

  // `between` is legal for number/date but not text/boolean -- the agent cannot infer this.
  it.each([
    ['number', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']],
    ['date', ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']],
    ['boolean', ['eq', 'neq']],
  ])('exposes the operators legal for a %s tag', (fieldType, expected) => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [{ tagName: 'Tag', tagSlot: 'tag1', fieldType }],
      })
    )

    expect(json.tagDefinitions[0].operators).toEqual(expected)
  })

  it('emits an empty operator list for an unrecognized field type rather than throwing', () => {
    const json = JSON.parse(
      serializeKBMeta({
        ...baseKb,
        tagDefinitions: [{ tagName: 'Tag', tagSlot: 'tag1', fieldType: 'mystery' }],
      })
    )

    expect(json.tagDefinitions[0].operators).toEqual([])
  })

  it('omits tag definitions when empty or undefined', () => {
    const empty = JSON.parse(serializeKBMeta({ ...baseKb, tagDefinitions: [] }))
    const missing = JSON.parse(serializeKBMeta(baseKb))

    expect(empty).not.toHaveProperty('tagDefinitions')
    expect(missing).not.toHaveProperty('tagDefinitions')
  })
})

function oauthTool(id: string, provider: string): ToolConfig {
  return {
    id,
    name: id,
    description: `Run ${id}`,
    version: '1.0.0',
    params: {},
    request: { url: 'https://example.com', method: 'POST', headers: () => ({}) },
    oauth: { required: true, provider },
  }
}

describe('serializeIntegrationSchema — service-account auth', () => {
  it('marks an OAuth service that also offers a service account, with its secret noun', () => {
    // Notion connects via OAuth or via an internal integration token; the agent
    // must be able to discover the second option from the same auth field.
    const schema = JSON.parse(serializeIntegrationSchema(oauthTool('notion_read', 'notion')))
    expect(schema.auth).toMatchObject({
      type: 'oauth',
      provider: 'notion',
      serviceAccount: { connectNoun: 'integration secret' },
    })
  })

  it('omits serviceAccount for an OAuth service that has no service-account flow', () => {
    const schema = JSON.parse(serializeIntegrationSchema(oauthTool('gh_read', 'github')))
    expect(schema.auth.type).toBe('oauth')
    expect(schema.auth.serviceAccount).toBeUndefined()
  })

  it('keeps service-account auth while suppressing an unavailable OAuth connection', () => {
    const schema = JSON.parse(
      serializeIntegrationSchema(oauthTool('notion_read', 'notion'), {
        oauthAvailable: false,
      })
    )

    expect(schema.auth.serviceAccount).toEqual({ connectNoun: 'integration secret' })
    expect(schema.oauth).toBeUndefined()
  })
})

describe('serializeCredentials — type distinguishes reconnect flow', () => {
  const now = new Date('2026-07-21T00:00:00.000Z')

  it('marks a service account so the agent reconnects it via the tag, not oauth', () => {
    const json = JSON.parse(
      serializeCredentials([
        {
          id: 'c1',
          providerId: 'notion-service-account',
          scope: null,
          credentialType: 'service_account',
          createdAt: now,
        },
        {
          id: 'c2',
          providerId: 'google-email',
          scope: null,
          credentialType: 'oauth',
          createdAt: now,
        },
      ])
    )
    expect(json[0]).toMatchObject({
      id: 'c1',
      provider: 'notion-service-account',
      type: 'service_account',
    })
    expect(json[1]).toMatchObject({ id: 'c2', provider: 'google-email', type: 'oauth' })
  })

  it('leaves env-var credentials typeless', () => {
    const json = JSON.parse(
      serializeCredentials([{ providerId: 'OPENAI_API_KEY', scope: 'workspace', createdAt: now }])
    )
    expect(json[0].type).toBeUndefined()
  })

  it('shows what a workspace secret is for, and omits the field when nothing was recorded', () => {
    const json = JSON.parse(
      serializeCredentials([
        {
          providerId: 'STRIPE_KEY',
          description: 'Stripe live key for billing',
          scope: 'workspace',
          createdAt: now,
        },
        { providerId: 'OPENAI_API_KEY', description: null, scope: 'workspace', createdAt: now },
      ])
    )
    expect(json[0].description).toBe('Stripe live key for billing')
    expect(json[1]).not.toHaveProperty('description')
  })
})

describe('serializeConnectors — cloneable references, never key material', () => {
  const now = new Date('2026-08-14T00:00:00.000Z')

  it('exposes credentialId and sourceConfig so a connector can be recreated', () => {
    const json = JSON.parse(
      serializeConnectors([
        {
          id: 'conn-1',
          connectorType: 'slack',
          status: 'active',
          syncMode: 'incremental',
          syncIntervalMinutes: 1440,
          credentialId: 'cred-42',
          sourceConfig: { channel: 'eng-help', maxMessages: '500' },
          lastSyncAt: now,
          lastSyncError: null,
          lastSyncDocCount: 12,
          nextSyncAt: null,
          consecutiveFailures: 0,
          createdAt: now,
        },
      ])
    )
    expect(json[0]).toMatchObject({
      id: 'conn-1',
      credentialId: 'cred-42',
      sourceConfig: { channel: 'eng-help', maxMessages: '500' },
    })
    expect(JSON.stringify(json)).not.toContain('encryptedApiKey')
  })

  it('omits the credential reference when a connector has none (API-key connectors)', () => {
    const json = JSON.parse(
      serializeConnectors([
        {
          id: 'conn-2',
          connectorType: 'github',
          status: 'active',
          syncMode: 'incremental',
          syncIntervalMinutes: 1440,
          credentialId: null,
          sourceConfig: { repository: 'simstudioai/sim', branch: 'staging' },
          lastSyncAt: null,
          lastSyncError: null,
          lastSyncDocCount: null,
          nextSyncAt: null,
          consecutiveFailures: 0,
          createdAt: now,
        },
      ])
    )
    expect(json[0].credentialId).toBeUndefined()
    expect(json[0].sourceConfig).toMatchObject({ repository: 'simstudioai/sim' })
  })
})

describe('account and organization namespace serializers', () => {
  it('references the files that own org and fork detail instead of restating them', () => {
    const workspace = JSON.parse(
      serializeAccountWorkspace({
        workspace: { id: 'ws-1', name: 'Elder', workspaceMode: 'standard' },
        viewer: { permission: 'admin', organizationRole: 'owner' },
        organization: { id: 'org-1', name: 'Acme' },
        forkedFrom: { id: 'ws-0', name: 'Elder (parent)' },
        entitlements: ['custom-blocks'],
      })
    )

    expect(workspace.yourPermission).toBe('admin')
    expect(workspace.organization).toEqual({
      id: 'org-1',
      name: 'Acme',
      yourRole: 'owner',
      detail: 'organization/organization.json',
    })
    expect(workspace.forkedFrom.detail).toBe('organization/forks.json')
    // The org record itself (plan, restrictions, members) must not be inlined —
    // one relation per file is what keeps the two from disagreeing.
    expect(workspace.organization.plan).toBeUndefined()
  })

  it('omits organization and fork stubs for a personal, unforked workspace', () => {
    const workspace = JSON.parse(
      serializeAccountWorkspace({
        workspace: { id: 'ws-1', name: 'Personal' },
        viewer: { permission: 'admin' },
        organization: null,
        forkedFrom: null,
        entitlements: [],
      })
    )

    expect(workspace.organization).toBeNull()
    expect(workspace.forkedFrom).toBeNull()
  })

  it('withholds member emails from a non-admin viewer and says so', () => {
    const members = [
      { userId: 'u-1', name: 'Ada', email: 'ada@example.com', permissionType: 'admin' },
      {
        userId: 'u-2',
        name: 'Grace',
        email: 'grace@example.com',
        permissionType: 'read',
        isExternal: true,
      },
    ]

    const asAdmin = JSON.parse(serializeAccountMembers(members, { includeContactDetails: true }))
    expect(asAdmin.members[0].email).toBe('ada@example.com')
    expect(asAdmin.note).toBeUndefined()

    const asMember = JSON.parse(serializeAccountMembers(members, { includeContactDetails: false }))
    expect(asMember.members.map((m: { email?: string }) => m.email)).toEqual([undefined, undefined])
    expect(asMember.members[0].name).toBe('Ada')
    expect(asMember.members[1].isExternal).toBe(true)
    expect(asMember.note).toContain('admins only')
  })

  it('keeps money and usage numbers in billing.json alone', () => {
    const billing = JSON.parse(
      serializeAccountBilling({
        plan: 'team',
        billingScope: 'organization',
        organizationId: 'org-1',
        usage: {
          currentPeriodCost: 12.5,
          limit: 100,
          remaining: 87.5,
          percentUsed: 12.5,
          isExceeded: false,
          billingPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
        },
        credits: { balance: 40, scope: 'organization' },
      })
    )

    expect(billing.plan).toBe('team')
    expect(billing.billedTo).toBe('organization')
    expect(billing.usage.billingPeriodEnd).toBe('2026-09-01T00:00:00.000Z')
    expect(billing.credits.balance).toBe(40)

    const organization = JSON.parse(
      serializeOrganization({
        organization: { id: 'org-1', relationship: 'internal', role: 'admin' },
        capabilities: { canManageOrganization: true, canManageBilling: true },
        plan: 'team',
        isEnterprise: false,
      })
    )
    expect(organization.usage).toBeUndefined()
    expect(organization.credits).toBeUndefined()
    expect(organization.note).toContain('account/billing.json')
  })

  it('describes access control as this viewer’s own binding restrictions', () => {
    const accessControl = JSON.parse(
      serializeAccessControl({
        entitled: true,
        permissionGroup: { id: 'pg-1', name: 'Contractors', resolution: 'explicit-member' },
        restrictions: [{ key: 'hideDeployApi', description: 'Cannot deploy workflows as APIs' }],
      })
    )

    expect(accessControl.governingPermissionGroup.appliedBecause).toBe('explicit-member')
    expect(accessControl.activeRestrictions).toEqual([
      { key: 'hideDeployApi', description: 'Cannot deploy workflows as APIs' },
    ])
    expect(accessControl.note).toContain('THIS user')
  })

  it('keeps the index to names and defers depth to per-block detail files', () => {
    const blocks = JSON.parse(
      serializeOrganizationCustomBlocks([
        {
          type: 'acme_scorer',
          name: 'Acme Scorer',
          description: 'Scores a lead',
          enabled: true,
          workflowId: 'wf-1',
          workflowName: 'Scorer',
          workspaceId: 'ws-9',
          workspaceName: 'Platform',
        },
      ])
    )

    expect(blocks.customBlocks[0]).toEqual({
      type: 'acme_scorer',
      name: 'Acme Scorer',
      enabled: true,
      detail: 'organization/custom-blocks/acme_scorer.json',
    })
    // Depth belongs to the detail file — an index row carrying provenance
    // would drift from it.
    expect(blocks.customBlocks[0].publishedFrom).toBeUndefined()
  })

  it('gives the detail file provenance, the schema pointer, and the read-only deployed graph', () => {
    const detail = JSON.parse(
      serializeOrgCustomBlockDetail(
        {
          type: 'acme_scorer',
          name: 'Acme Scorer',
          enabled: true,
          workflowId: 'wf-1',
          workflowName: 'Scorer',
          workspaceId: 'ws-9',
          workspaceName: 'Platform',
        },
        { blocks: { b1: { type: 'agent' } }, edges: [{ source: 'b1', target: 'b2' }] }
      )
    )

    expect(detail.publishedFrom.workflowId).toBe('wf-1')
    expect(detail.schema).toBe('components/blocks/acme_scorer.json')
    expect(detail.deployedWorkflowState.edges).toHaveLength(1)
    // The graph is the deployed one and is not editable from here; the note
    // is what tells the model both facts.
    expect(detail.note).toContain('DEPLOYED')
    expect(detail.note).toContain('publishing workspace')
  })

  it('writes the namespace guide with the inventory the index defers', () => {
    const readme = buildOrganizationReadme({
      organizationId: 'org-1',
      isEnterprise: true,
      customBlocks: [
        {
          type: 'acme_scorer',
          name: 'Acme Scorer',
          enabled: true,
          workflowName: 'Scorer',
          workspaceName: 'Platform',
        },
        { type: 'acme_retired', name: 'Retired', enabled: false },
      ],
      forksMounted: false,
      permissionGroupsMounted: false,
      connectedAccountsMounted: true,
    })

    expect(readme).toContain('# Organization')
    expect(readme).toContain('custom-blocks/{type}.json')
    expect(readme).toContain('**Acme Scorer** (`acme_scorer`) — published from Scorer in Platform')
    expect(readme).toContain('**Retired** (`acme_retired`) — disabled')
    // Gated files must not be advertised when unmounted for this viewer.
    expect(readme).not.toContain('forks.json')
    expect(readme).not.toContain('permission-groups.json')
    expect(readme).toContain('connected-accounts.json')
  })

  it('serializes singleton readiness without credentials, people, or container selection', () => {
    const accounts = {
      id: 'cg-1',
      name: 'Connected accounts',
      status: 'active' as const,
      options: [
        {
          provider: 'gmail',
          label: 'Work email',
          required: true,
          status: 'active' as const,
          configurationStatus: 'ready',
        },
        {
          provider: 'slack',
          status: 'disabled' as const,
          configurationStatus: 'not_configured',
          slackBotCredentialId: 'private-credential-id',
        },
      ],
      enrollmentCounts: { completed: 2 },
      people: [{ email: 'private@example.com', status: 'completed' }],
      encryptedProviderConfiguration: 'private-configuration',
    }

    const serialized = serializeConnectedAccounts(accounts)
    const catalog = JSON.parse(serialized)
    expect(catalog.status).toBe('active')
    expect(catalog.options[1]).toEqual({
      provider: 'slack',
      status: 'disabled',
      configurationStatus: 'not_configured',
    })
    expect(catalog.credentialGroups).toBeUndefined()
    expect(catalog.id).toBeUndefined()
    expect(catalog.people).toBeUndefined()
    expect(catalog.enrollments).toBeUndefined()
    expect(serialized).not.toContain('private-')
    expect(serialized).not.toContain('private@example.com')
    expect(catalog.note).toContain('no container selection is required')
  })

  it('maps the org workspace directory with access flags and fork parentage', () => {
    const dir = JSON.parse(
      serializeOrganizationWorkspaces([
        { id: 'ws-1', name: 'Platform', hasAccess: true, forkedFromWorkspaceId: null },
        { id: 'ws-2', name: 'Client Fork', hasAccess: false, forkedFromWorkspaceId: 'ws-1' },
      ])
    )
    expect(dir.workspaces[1]).toEqual({
      id: 'ws-2',
      name: 'Client Fork',
      hasAccess: false,
      forkedFromWorkspaceId: 'ws-1',
    })
    expect(dir.note).toContain('nameable, not readable')
  })

  it('gives the admin roster restrictions per group, not per viewer', () => {
    const roster = JSON.parse(
      serializePermissionGroupRoster([
        {
          id: 'pg-1',
          name: 'Contractors',
          description: null,
          isDefault: false,
          memberCount: 4,
          workspaces: [{ id: 'ws-1', name: 'Platform' }],
          activeRestrictions: [{ key: 'hideDeployApi', description: 'Cannot deploy as API' }],
        },
      ])
    )
    expect(roster.permissionGroups[0].memberCount).toBe(4)
    expect(roster.permissionGroups[0].activeRestrictions[0].key).toBe('hideDeployApi')
    expect(roster.note).toContain('access-control.json')
  })

  it('summarizes fork mappings by resource type and omits them at the root', () => {
    const forked = JSON.parse(
      serializeWorkspaceForks({
        parent: { id: 'ws-0', name: 'Template' },
        children: [{ id: 'ws-2', name: 'Child', createdAt: new Date('2026-08-01T00:00:00.000Z') }],
        resourceMappingCounts: { workflow: 3, table: 1 },
        blockMappingCount: 12,
      })
    )
    expect(forked.mappedFromParent).toEqual({ resources: { workflow: 3, table: 1 }, blocks: 12 })
    expect(forked.children[0].createdAt).toBe('2026-08-01T00:00:00.000Z')

    const root = JSON.parse(
      serializeWorkspaceForks({
        parent: null,
        children: [],
        resourceMappingCounts: {},
        blockMappingCount: 0,
      })
    )
    expect(root.mappedFromParent).toBeUndefined()
  })

  it('marks the current workspace and never implies the others are readable', () => {
    const roster = JSON.parse(
      serializeAccountWorkspaces([
        { id: 'ws-1', name: 'Elder', role: 'admin', isCurrent: true, organizationId: 'org-1' },
        {
          id: 'ws-2',
          name: 'Other',
          role: 'read',
          isCurrent: false,
          forkedFromWorkspaceId: 'ws-1',
        },
      ])
    )

    expect(roster.workspaces[0].isCurrent).toBe(true)
    expect(roster.workspaces[1].isCurrent).toBeUndefined()
    expect(roster.workspaces[1].forkedFromWorkspaceId).toBe('ws-1')
    expect(roster.note).toContain('isCurrent')
  })
})
