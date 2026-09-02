/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadNormalized: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mocks.loadNormalized,
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
      ],
      outputs: {},
    }
  },
}))

import { buildWorkflowExportPayload } from '@/lib/workflows/operations/export-workflow'

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
    vi.clearAllMocks()
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
})
