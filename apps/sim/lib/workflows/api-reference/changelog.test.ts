/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListVersions, mockLoadVersionState } = vi.hoisted(() => ({
  mockListVersions: vi.fn(),
  mockLoadVersionState: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  listWorkflowVersions: mockListVersions,
  loadWorkflowDeploymentVersionState: mockLoadVersionState,
}))

import { computeVersionChangelog } from '@/lib/workflows/api-reference/changelog'

/** Builds a deployed-state fixture with the given input fields and response fields. */
function state(inputs: Array<{ name: string; type: string }>, outputs: string[]) {
  return {
    blocks: {
      trigger: {
        type: 'api_trigger',
        subBlocks: {
          inputFormat: { value: inputs.map((f, i) => ({ id: `id-${i}`, ...f })) },
        },
      },
      response: {
        type: 'response',
        subBlocks: {
          dataMode: { value: 'structured' },
          builderData: {
            value: {
              schema: {
                properties: Object.fromEntries(outputs.map((name) => [name, { type: 'string' }])),
              },
            },
          },
        },
      },
    },
    edges: [],
  }
}

describe('computeVersionChangelog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the first version non-breaking and flags a removed input as breaking', async () => {
    mockListVersions.mockResolvedValue({
      versions: [
        { id: 'v1', version: 1, createdAt: new Date('2026-01-01') },
        { id: 'v2', version: 2, createdAt: new Date('2026-01-02') },
      ],
    })
    mockLoadVersionState.mockImplementation(async (_wf: string, id: string) =>
      id === 'v1'
        ? state(
            [
              { name: 'a', type: 'string' },
              { name: 'selectedApps', type: 'array' },
            ],
            ['out']
          )
        : state([{ name: 'a', type: 'string' }], ['out'])
    )

    const changelog = await computeVersionChangelog('wf-1')
    // Newest first.
    expect(changelog.map((v) => v.version)).toEqual([2, 1])
    const v2 = changelog[0]
    expect(v2.breaking).toBe(true)
    expect(v2.changes.join(' ')).toContain('removed input field `selectedApps`')
    const v1 = changelog[1]
    expect(v1.breaking).toBe(false)
    expect(v1.changes).toEqual(['initial version'])
  })

  it('flags a retyped input and a removed output as breaking; additions are not', async () => {
    mockListVersions.mockResolvedValue({
      versions: [
        { id: 'v1', version: 1, createdAt: new Date('2026-01-01') },
        { id: 'v2', version: 2, createdAt: new Date('2026-01-02') },
      ],
    })
    mockLoadVersionState.mockImplementation(async (_wf: string, id: string) =>
      id === 'v1'
        ? state([{ name: 'count', type: 'string' }], ['answer', 'score'])
        : state(
            [
              { name: 'count', type: 'number' },
              { name: 'extra', type: 'string' },
            ],
            ['answer']
          )
    )

    const [v2] = await computeVersionChangelog('wf-1')
    expect(v2.breaking).toBe(true)
    const joined = v2.changes.join(' ')
    expect(joined).toContain('retyped input field `count`')
    expect(joined).toContain('removed output field `score`')
    expect(joined).toContain('added input field `extra`')
  })

  it('returns an empty changelog for a never-deployed workflow', async () => {
    mockListVersions.mockResolvedValue({ versions: [] })
    expect(await computeVersionChangelog('wf-1')).toEqual([])
  })
})
