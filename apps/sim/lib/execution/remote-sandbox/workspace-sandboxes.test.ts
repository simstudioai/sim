/**
 * @vitest-environment node
 *
 * Pins where a write spends its admission: after the spec has validated and
 * the name is known to be free, immediately before the write that schedules a
 * build. A refused line or a name collision builds nothing, so it must not
 * consume the budget a real build needs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockInsert, mockUpdate, calls } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  calls: [] as string[],
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect, insert: mockInsert, update: mockUpdate, delete: vi.fn() },
}))
vi.mock('@sim/db/schema', () => ({
  workspaceSandbox: {
    id: 'id',
    workspaceId: 'workspace_id',
    name: 'name',
    language: 'language',
    dependencies: 'dependencies',
    cliTools: 'cli_tools',
    systemPackages: 'system_packages',
    specHash: 'spec_hash',
    createdBy: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  sandboxImage: {
    provider: 'provider',
    specHash: 'spec_hash',
    status: 'status',
    errorCode: 'error_code',
    errorMessage: 'error_message',
    errorDetail: 'error_detail',
    updatedAt: 'updated_at',
  },
}))
vi.mock('drizzle-orm', () => {
  const sql = Object.assign((strings: TemplateStringsArray) => ({ sql: strings.join('?') }), {
    param: (value: unknown) => value,
    raw: (value: unknown) => value,
  })
  return {
    and: (...args: unknown[]) => args,
    eq: (...args: unknown[]) => args,
    gt: (...args: unknown[]) => args,
    lt: (...args: unknown[]) => args,
    or: (...args: unknown[]) => args,
    ilike: (...args: unknown[]) => args,
    inArray: (...args: unknown[]) => args,
    asc: (value: unknown) => value,
    desc: (value: unknown) => value,
    sql,
  }
})
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({ id: 'e2b', dependencyStrategy: 'runtime' }),
}))
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
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: vi.fn(),
}))

import {
  createWorkspaceSandbox,
  SandboxDependencyError,
  updateWorkspaceSandbox,
  WorkspaceSandboxNameConflictError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'

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
    vi.clearAllMocks()
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
