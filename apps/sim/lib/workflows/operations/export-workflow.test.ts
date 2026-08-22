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
  getBlock: (type: string) =>
    type === 'agent'
      ? {
          name: 'Agent',
          subBlocks: [{ id: 'tools', type: 'tool-input' }],
          outputs: {},
        }
      : {
          name: 'Slack',
          subBlocks: [
            { id: 'credential', type: 'oauth-input' },
            { id: 'botToken', type: 'short-input', password: true },
            { id: 'text', type: 'long-input' },
          ],
          outputs: {},
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
