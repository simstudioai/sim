/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import { hostedKeyEnabledWhen } from '@/tools/hosting'
import type { ToolConfig } from '@/tools/types'
import {
  serializeApiKeyIntegrations,
  serializeBlockSchema,
  serializeFileMeta,
  serializeIntegrationSchema,
  serializeKBMeta,
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

  it('omits serviceAccount when the flow is gated by a preview block (slack custom bot ↔ slack_v2)', () => {
    // slack_v2 is preview: true, so the shared schema must not leak the custom
    // bot — parallel to how preview tools stay out of the shared aggregates.
    const schema = JSON.parse(serializeIntegrationSchema(oauthTool('slack_send', 'slack')))
    expect(schema.auth.type).toBe('oauth')
    expect(schema.auth.serviceAccount).toBeUndefined()
  })
})
