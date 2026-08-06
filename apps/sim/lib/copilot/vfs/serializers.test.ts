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
  serializeApiKeyIntegrations,
  serializeBlockSchema,
  serializeCredentials,
  serializeDeployments,
  serializeFileMeta,
  serializeIntegrationSchema,
  serializeKBMeta,
  serializeSandbox,
  serializeSandboxCatalog,
  serializeTableMeta,
  serializeWorkflowMeta,
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

  // The preview-gate behavior (slack custom bot ↔ slack_v2) is covered in
  // service-account-gate.test.ts, which mocks getBlock — the block registry is
  // globally stubbed here, so slack_v2's real `preview: true` isn't observable
  // through serializeIntegrationSchema.
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
})
