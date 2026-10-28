/**
 * Pins where a write spends its admission: after the spec has validated and
 * the name is known to be free, immediately before the write that schedules a
 * build. A refused line or a name collision builds nothing, so it must not
 * consume the budget a real build needs.
 */
import { backgroundTaskMock } from '@sim/testing/mocks/background-task.mock'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
vi.mock('@/lib/execution/remote-sandbox/cli-tools.server', () => ({
  assertSandboxCliToolsSupported: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/image-registry', () => ({
  ensureSandboxImage: vi.fn(),
  releaseSandboxImage: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  invalidateSandboxResolution: vi.fn(),
}))
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)

import {
  createWorkspaceSandbox,
  SandboxDependencyError,
  updateWorkspaceSandbox,
  WorkspaceSandboxNameConflictError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'

const { select: mockSelect, insert: mockInsert, update: mockUpdate } = dbChainMockFns
const calls: string[] = []

remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
  id: 'e2b',
  dependencyStrategy: 'runtime',
})

const WORKSPACE_ID = 'workspace-1'
const ROW = {
  id: 'sandbox-1',
  name: 'data-tools',
  language: 'python',
  dependencies: ['pandas'],
  cliTools: [],
  systemPackages: [],
  specHash: 'hash-1',
  createdAt: new Date('2026-08-04T11:00:00Z'),
  updatedAt: new Date('2026-08-04T12:00:00Z'),
}

/** Queues the rows each successive `db.select()` chain resolves to. */
function queueSelects(...results: unknown[][]) {
  mockSelect.mockReset()
  for (const rows of results) {
    mockSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    })
  }
}

const admit = vi.fn(async () => {
  calls.push('admit')
})

describe('sandbox write admission', () => {
  beforeEach(() => {
    calls.length = 0
    mockInsert.mockReturnValue({
      values: async () => {
        calls.push('insert')
      },
    })
    mockUpdate.mockReturnValue({
      set: () => ({
        where: async () => {
          calls.push('update')
        },
      }),
    })
  })

  it('admits a create only after the spec validated and the name is free, before the write', async () => {
    queueSelects([], [ROW])

    const sandbox = await createWorkspaceSandbox(
      WORKSPACE_ID,
      'user-1',
      { name: 'data-tools', language: 'python', dependencies: ['pandas'] },
      { admit }
    )

    expect(sandbox.id).toBe('sandbox-1')
    expect(calls).toEqual(['admit', 'insert'])
  })

  it('refuses an invalid dependency before admission', async () => {
    queueSelects([])

    await expect(
      createWorkspaceSandbox(
        WORKSPACE_ID,
        'user-1',
        { name: 'data-tools', language: 'python', dependencies: ['not a package!'] },
        { admit }
      )
    ).rejects.toBeInstanceOf(SandboxDependencyError)
    expect(admit).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('refuses a taken name before admission', async () => {
    queueSelects([{ id: 'sandbox-other' }])

    await expect(
      createWorkspaceSandbox(
        WORKSPACE_ID,
        'user-1',
        { name: 'data-tools', language: 'python', dependencies: ['pandas'] },
        { admit }
      )
    ).rejects.toBeInstanceOf(WorkspaceSandboxNameConflictError)
    expect(admit).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('admits an edit only after the merged spec validated, before the write', async () => {
    queueSelects([ROW], [ROW])

    await updateWorkspaceSandbox(
      WORKSPACE_ID,
      ROW.id,
      { dependencies: ['pandas', 'numpy'] },
      { admit }
    )

    expect(calls).toEqual(['admit', 'update'])
  })

  it('refuses an invalid edit before admission', async () => {
    queueSelects([ROW])

    await expect(
      updateWorkspaceSandbox(WORKSPACE_ID, ROW.id, { dependencies: ['bad line!'] }, { admit })
    ).rejects.toBeInstanceOf(SandboxDependencyError)
    expect(admit).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
