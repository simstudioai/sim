import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { V2BlockDetail } from '@/lib/api/contracts/v2/catalog'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'

const { permissionConfig, denied } = vi.hoisted(() => ({
  permissionConfig: { current: null as { deniedTools?: string[] } | null },
  denied: {
    current: {
      needsProjection: new Map<string, ReadonlySet<string>>(),
      fullyDenied: new Set<string>(),
    },
  },
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: vi.fn(async () => permissionConfig.current),
}))

vi.mock('@/lib/mothership/integration-tool-projection', () => ({
  resolveDeniedBlockOperations: vi.fn(() => denied.current),
}))

const viewer = { workspaceId: 'ws', userId: 'user' }

function blockDetail(): V2BlockDetail {
  return {
    id: 'slack',
    name: 'Slack',
    description: 'Messaging',
    category: 'tools',
    source: 'builtin',
    triggerAllowed: false,
    triggerCapable: false,
    triggerIds: [],
    triggers: [],
    tags: [],
    preview: false,
    operationIds: ['send', 'canvas'],
    toolIds: ['slack_send', 'slack_canvas'],
    inputSchema: [
      { id: 'operation', type: 'dropdown', options: [{ id: 'send' }, { id: 'canvas' }] },
    ],
    operationInputSchema: { send: [], canvas: [] },
    inputDefinitions: {},
    outputs: {},
    operations: {
      send: { toolId: 'slack_send', inputs: {}, outputs: {}, inputSchema: [] },
      canvas: { toolId: 'slack_canvas', inputs: {}, outputs: {}, inputSchema: [] },
    },
    tools: ['slack_send', 'slack_canvas'].map((id) => ({
      id,
      name: id,
      description: '',
      hostedApiKey: 'none',
      params: {},
      outputs: {},
    })),
  }
}

function ok(stdout: string) {
  return { exitCode: 0, stdout, stderr: '' }
}

describe('curateBlockDetail', () => {
  beforeEach(() => {
    permissionConfig.current = null
    denied.current = { needsProjection: new Map(), fullyDenied: new Set() }
  })

  it('passes through when the viewer has no denied tools', async () => {
    const input = ok(JSON.stringify(blockDetail()))
    expect(await curateBlockDetail(input, viewer)).toBe(input)
  })

  it('passes through non-block output untouched', async () => {
    permissionConfig.current = { deniedTools: ['slack_canvas'] }
    const input = ok('not json')
    expect(await curateBlockDetail(input, viewer)).toBe(input)
  })

  it('drops denied operations and their tools from a partially denied block', async () => {
    permissionConfig.current = { deniedTools: ['slack_canvas'] }
    denied.current = {
      needsProjection: new Map([['slack', new Set(['canvas'])]]),
      fullyDenied: new Set(),
    }
    const result = await curateBlockDetail(ok(JSON.stringify(blockDetail())), viewer)
    expect(result.exitCode).toBe(0)
    const curated = JSON.parse(result.stdout)
    expect(Object.keys(curated.operations)).toEqual(['send'])
    expect(curated.tools.map((tool: { id: string }) => tool.id)).toEqual(['slack_send'])
    expect(curated.operationIds).toEqual(['send'])
    expect(curated.operationInputSchema).toEqual({ send: [] })
    expect(curated.inputSchema[0].options).toEqual([{ id: 'send' }])
    expect(curated.toolIds).toEqual(['slack_send'])
  })

  it('refuses a fully denied block', async () => {
    permissionConfig.current = { deniedTools: ['slack_send', 'slack_canvas'] }
    denied.current = { needsProjection: new Map(), fullyDenied: new Set(['slack']) }
    const result = await curateBlockDetail(ok(JSON.stringify(blockDetail())), viewer)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not available to you')
  })
})
