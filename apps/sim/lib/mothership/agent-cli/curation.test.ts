import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function blockDetail() {
  return {
    type: 'slack',
    operations: {
      send: { toolId: 'slack_send' },
      canvas: { toolId: 'slack_canvas' },
    },
    tools: [{ id: 'slack_send' }, { id: 'slack_canvas' }],
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
    expect(curated.tools).toEqual([{ id: 'slack_send' }])
  })

  it('refuses a fully denied block', async () => {
    permissionConfig.current = { deniedTools: ['slack_send', 'slack_canvas'] }
    denied.current = { needsProjection: new Map(), fullyDenied: new Set(['slack']) }
    const result = await curateBlockDetail(ok(JSON.stringify(blockDetail())), viewer)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not available to you')
  })
})
