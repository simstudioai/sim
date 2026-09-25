import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadNormalized: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
  CREDENTIAL_SUBBLOCK_IDS: new Set(['credential', 'triggerCredentials', 'oauthCredential']),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: (type: string) => {
    if (type === 'agent') {
      return {
        name: 'Agent',
        subBlocks: [{ id: 'tools', type: 'tool-input' }],
        outputs: {},
      }
    }
    if (type === 'mcp') {
      return {
        name: 'MCP',
        subBlocks: [
          { id: 'serverSelector', type: 'mcp-server-selector' },
          {
            id: 'toolSelector',
            type: 'mcp-tool-selector',
            dependsOn: ['serverSelector'],
            selectorKey: 'mcp.tools',
          },
        ],
        outputs: {},
      }
    }
    if (type === 'table_v2') {
      return {
        name: 'Table',
        subBlocks: [
          { id: 'credential', type: 'oauth-input' },
          {
            id: 'tableSelector',
            type: 'table-selector',
            canonicalParamId: 'tableId',
            mode: 'basic',
            required: true,
          },
          {
            id: 'manualTableId',
            type: 'short-input',
            canonicalParamId: 'tableId',
            mode: 'advanced',
            required: true,
          },
        ],
        outputs: {},
      }
    }
    return {
      name: 'Slack',
      subBlocks: [
        { id: 'credential', type: 'oauth-input' },
        { id: 'botToken', type: 'short-input', password: true },
        { id: 'text', type: 'long-input' },
        { id: 'headers', type: 'table' },
      ],
      outputs: {},
    }
  },
}))

import { v2ExportWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { resolveImportedMetadata } from '@/lib/workflows/operations/import-workflow'
import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'

/**
 * Asserts real tool params and outputs, which the global `@/tools/metadata`
 * and `@/tools/metadata-outputs` mocks in vitest.setup.ts empty.
 */
vi.unmock('@/tools/metadata')
vi.unmock('@/tools/metadata-outputs')

describe('buildWorkflowExportPayload', () => {
  beforeEach(() => {
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

  it.each(['search_docs', 'read_document'])(
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
              serverSelector: {
                id: 'serverSelector',
                type: 'mcp-server-selector',
                value: 'source-server',
              },
              toolSelector: { id: 'toolSelector', type: 'mcp-tool-selector', value },
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
      expect(portable!.state.blocks.mcp.subBlocks.toolSelector.value).toBe(value)
      const plan = buildWorkflowImportPlan(
        { ...portable! },
        { mappings: [{ kind: 'mcp-server', sourceId: 'source-server', targetId: 'target-server' }] }
      )
      expect(plan.state.blocks.mcp.subBlocks.serverSelector.value).toBe('target-server')
      expect(plan.state.blocks.mcp.subBlocks.toolSelector.value).toBe(value)
      const legacy = await buildWorkflowExportPayload(record)
      expect(legacy!.state.blocks.mcp.subBlocks.toolSelector.value).toBeNull()
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
            subBlocks: { toolSelector: { id: 'toolSelector', type: 'mcp-tool-selector', value } },
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
      expect(payload!.state.blocks.mcp.subBlocks.toolSelector.value).toBeNull()
      expect(JSON.stringify(payload)).not.toContain('secret-token')
    }
  )
})

describe('buildWorkflowExportPayload with includeWorkspaceBindings', () => {
  const record = {
    id: 'workflow-1',
    name: 'Reports',
    description: null,
    workspaceId: 'workspace-1',
    folderId: null,
    variables: {},
  }

  beforeEach(() => {
    mocks.loadNormalized.mockResolvedValue({
      blocks: {
        lookup: {
          id: 'lookup',
          type: 'table_v2',
          name: 'Lookup',
          position: { x: 0, y: 0 },
          subBlocks: {
            credential: { id: 'credential', type: 'oauth-input', value: 'cred-1' },
            tableSelector: {
              id: 'tableSelector',
              type: 'table-selector',
              value: 'tbl_239e870374c14d4a89923175a7b10648',
            },
            manualTableId: { id: 'manualTableId', type: 'short-input', value: null },
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

  /**
   * The default export is the sharing-safe one and clears the table id; the
   * same-workspace round trip keeps it, and neither keeps the credential.
   */
  it('keeps workspace bindings only when asked, and never the credential', async () => {
    const sharing = await buildWorkflowExportPayload(record)
    const sameWorkspace = await buildWorkflowExportPayload(record, {
      includeWorkspaceBindings: true,
    })

    expect(sharing?.state.blocks.lookup.subBlocks.tableSelector.value).toBeNull()
    expect(sameWorkspace?.state.blocks.lookup.subBlocks.tableSelector.value).toBe(
      'tbl_239e870374c14d4a89923175a7b10648'
    )
    expect(sharing?.state.blocks.lookup.subBlocks.credential.value).toBeNull()
    expect(sameWorkspace?.state.blocks.lookup.subBlocks.credential.value).toBeNull()
  })
  it.each([false, true])(
    'round trips the diagnostic export envelope with references=%s',
    async (includeReferences) => {
      const payload = await buildWorkflowExportPayload(record, {
        includeReferences,
        includeWorkspaceBindings: true,
      })
      const response = v2ExportWorkflowContract.response.schema.parse({
        data: {
          ...payload,
          representation: 'portable-export',
          warnings: ['Portable export; use state get for in-place edits.'],
          workflow: { ...payload!.workflow, folderPath: '/' },
        },
      })
      const parsed = parseWorkflowJson(JSON.stringify(response))
      expect(parsed.errors).toEqual([])
      const imported = Object.values(parsed.data!.blocks).find((block) => block.name === 'Lookup')!
      expect(imported.subBlocks.tableSelector.value).toBe('tbl_239e870374c14d4a89923175a7b10648')
      expect(imported.subBlocks.credential.value).toBeNull()
      expect(resolveImportedMetadata(response)).toMatchObject({ name: record.name })
      expect(response.data.referenceManifest !== undefined).toBe(includeReferences)
    }
  )
})
