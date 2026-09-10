/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadNormalized: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
  CREDENTIAL_SUBBLOCK_IDS: new Set(['credential', 'triggerCredentials', 'oauthCredential']),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) =>
    type === 'agent'
      ? {
          name: 'Agent',
          subBlocks: [{ id: 'tools', type: 'tool-input' }],
          outputs: {},
        }
      : type === 'mcp'
        ? {
            name: 'MCP',
            subBlocks: [
              { id: 'server', type: 'mcp-server-selector' },
              {
                id: 'tool',
                type: 'mcp-tool-selector',
                dependsOn: ['server'],
                selectorKey: 'mcp.tools',
              },
            ],
            outputs: {},
          }
        : {
            name: 'Slack',
            subBlocks: [
              { id: 'credential', type: 'oauth-input' },
              { id: 'botToken', type: 'short-input', password: true },
              { id: 'text', type: 'long-input' },
              { id: 'headers', type: 'table' },
            ],
            outputs: {},
          },
}))

import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'

/**
 * Asserts real tool params and outputs, which the global `@/tools/metadata`
 * and `@/tools/metadata-outputs` mocks in vitest.setup.ts empty.
 */
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

describe('buildWorkflowExportPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadNormalized.mockResolvedValue({
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          subBlocks: {
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: [
                {
                  type: 'slack',
                  toolId: 'slack_message',
                  params: {
                    credential: 'nested-credential-id',
                    botToken: 'nested-xoxb-secret',
                    text: 'ordinary message',
                  },
                },
              ],
            },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  it('redacts nested tool credentials from the public export payload', async () => {
    const payload = await buildWorkflowExportPayload({
      id: 'workflow-1',
      name: 'Reports',
      description: null,
      workspaceId: 'workspace-1',
      folderId: null,
      variables: {},
    })

    const params = payload?.state.blocks.agent.subBlocks.tools.value[0].params
    expect(params).toEqual({
      credential: null,
      botToken: null,
      text: 'ordinary message',
    })
    expect(JSON.stringify(payload)).not.toContain('nested-credential-id')
    expect(JSON.stringify(payload)).not.toContain('nested-xoxb-secret')
  })

  it('round trips retained environment occurrences while withholding opaque and prefixed secrets', async () => {
    const tools = [
      {
        type: 'slack',
        toolId: 'slack_message',
        params: {
          credential: 'nested-credential-id',
          botToken: 'nested-secret-prefix-{{NESTED_PREFIX_ONLY}}',
          text: 'Hello {{SHARED_SECRET}}',
          unknown: '{{OPAQUE_ONLY}}',
          headers: [{ name: 'Authorization', value: '{{NESTED_HEADER_ONLY}}' }],
        },
      },
    ]
    mocks.loadNormalized.mockResolvedValue({
      blocks: {
        slack: {
          id: 'slack',
          type: 'slack',
          name: 'Slack',
          position: { x: 0, y: 0 },
          outputs: {},
          enabled: true,
          subBlocks: {
            credential: { id: 'credential', type: 'oauth-input', value: 'top-credential-id' },
            botToken: {
              id: 'botToken',
              type: 'short-input',
              value: 'raw-secret-prefix-{{PREFIX_ONLY}}',
            },
            text: { id: 'text', type: 'long-input', value: 'Text {{SHARED_SECRET}}' },
            headers: {
              id: 'headers',
              type: 'table',
              value: [
                { name: 'Authorization', value: 'Bearer raw-header-secret-{{HEADER_ONLY}}' },
                { name: 'Shared', value: '{{SHARED_SECRET}}' },
              ],
            },
          },
        },
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 100, y: 0 },
          outputs: {},
          enabled: true,
          subBlocks: { tools: { id: 'tools', type: 'tool-input', value: JSON.stringify(tools) } },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    const record = {
      id: 'workflow-1',
      name: 'Reports',
      description: null,
      workspaceId: 'workspace-1',
      folderId: null,
      variables: {},
    }
    const payload = await buildWorkflowExportPayload(record, { includeReferences: true })
    expect(payload).not.toBeNull()
    const references = payload!.referenceManifest!.references
    expect(references.filter((reference) => reference.kind === 'env-var')).toEqual([
      {
        kind: 'env-var',
        sourceId: 'SHARED_SECRET',
        required: true,
        occurrences: [
          {
            blockId: 'slack',
            subBlockKey: 'text',
            valuePath: [],
            encoding: 'environment',
            positions: [],
          },
          {
            blockId: 'agent',
            subBlockKey: 'tools',
            valuePath: [0, 'params', 'text'],
            encoding: 'environment',
            positions: [],
          },
        ],
      },
    ])
    expect(
      references
        .filter((reference) => reference.kind === 'credential')
        .map((reference) => reference.sourceId)
        .sort()
    ).toEqual(['nested-credential-id', 'top-credential-id'])
    const wire = JSON.stringify(payload)
    for (const withheld of [
      'raw-secret-prefix',
      'raw-header-secret',
      'nested-secret-prefix',
      'HEADER_ONLY',
      'PREFIX_ONLY',
      'OPAQUE_ONLY',
    ])
      expect(wire).not.toContain(withheld)
    expect(payload!.state.blocks.slack.subBlocks.headers.value).toBeNull()
    expect(payload!.state.blocks.slack.subBlocks.botToken.value).toBeNull()
    const plan = buildWorkflowImportPlan(
      { ...payload! },
      {
        mappings: references.map((reference) => ({
          kind: reference.kind,
          sourceId: reference.sourceId,
          targetId:
            reference.kind === 'env-var'
              ? `TARGET_${reference.sourceId}`
              : `target-${reference.sourceId}`,
        })),
      }
    )
    expect(plan.unresolvedBindings).toEqual([])
    expect(plan.state.blocks.slack.subBlocks.text.value).toBe('Text {{TARGET_SHARED_SECRET}}')
    const importedTools = plan.state.blocks.agent.subBlocks.tools.value
    expect(typeof importedTools).toBe('string')
    expect(JSON.parse(importedTools as string)[0].params.text).toBe(
      'Hello {{TARGET_SHARED_SECRET}}'
    )
    const legacy = await buildWorkflowExportPayload(record)
    expect(legacy!.referenceManifest).toBeUndefined()
    expect(legacy!.state.blocks.agent.subBlocks.tools.value).toBeNull()
  })

  it.each(['mcp-source-server-search_docs', 'search_docs'])(
    'preserves safe MCP selection metadata only when opted in: %s',
    async (value) => {
      mocks.loadNormalized.mockResolvedValue({
        blocks: {
          mcp: {
            id: 'mcp',
            type: 'mcp',
            name: 'MCP',
            position: { x: 0, y: 0 },
            outputs: {},
            enabled: true,
            subBlocks: {
              server: { id: 'server', type: 'mcp-server-selector', value: 'source-server' },
              tool: { id: 'tool', type: 'mcp-tool-selector', value },
            },
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      })
      const record = {
        id: 'workflow-1',
        name: 'MCP',
        description: null,
        workspaceId: 'workspace-1',
        folderId: null,
        variables: {},
      }
      const portable = await buildWorkflowExportPayload(record, { includeReferences: true })
      expect(portable!.state.blocks.mcp.subBlocks.tool.value).toBe(value)
      const plan = buildWorkflowImportPlan(
        { ...portable! },
        { mappings: [{ kind: 'mcp-server', sourceId: 'source-server', targetId: 'target-server' }] }
      )
      expect(plan.state.blocks.mcp.subBlocks.tool.value).toBe(
        value.replace('source-server', 'target-server')
      )
      const legacy = await buildWorkflowExportPayload(record)
      expect(legacy!.state.blocks.mcp.subBlocks.tool.value).toBeNull()
    }
  )

  it.each(['https://example.com/tools?token=secret-token', 'Bearer secret-token'])(
    'withholds unsafe MCP selector payloads with references enabled: %s',
    async (value) => {
      mocks.loadNormalized.mockResolvedValue({
        blocks: {
          mcp: {
            id: 'mcp',
            type: 'mcp',
            name: 'MCP',
            position: { x: 0, y: 0 },
            outputs: {},
            enabled: true,
            subBlocks: { tool: { id: 'tool', type: 'mcp-tool-selector', value } },
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      })
      const payload = await buildWorkflowExportPayload(
        {
          id: 'workflow-1',
          name: 'MCP',
          description: null,
          workspaceId: 'workspace-1',
          folderId: null,
          variables: {},
        },
        { includeReferences: true }
      )
      expect(payload!.state.blocks.mcp.subBlocks.tool.value).toBeNull()
      expect(JSON.stringify(payload)).not.toContain('secret-token')
    }
  )
})
