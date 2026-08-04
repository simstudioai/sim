/**
 * @vitest-environment node
 */

import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/execution/remote-sandbox/image-registry', () => ({
  ensureSandboxImage: vi.fn(),
  releaseSandboxImage: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  invalidateSandboxResolution: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({ id: 'e2b', dependencyStrategy: 'runtime' }),
}))

vi.mock('@/lib/core/utils/background', () => ({
  runDetached: vi.fn(),
}))

import {
  createWorkspaceSandbox,
  updateWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'

const { workspaceSandbox } = schemaMock

const existingRow = {
  id: 'sb-1',
  name: 'data-tools',
  language: 'python',
  dependencies: ['requests'],
  specHash: 'hash-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('workspace sandbox operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  describe('name validation', () => {
    it.each([
      ['empty', '', 'Name is required'],
      ['whitespace-only', '   ', 'Name is required'],
      ['over 64 characters', 'x'.repeat(65), 'Name must be 64 characters or fewer'],
    ])('refuses a %s name on create', async (_label, name, message) => {
      const result = await createWorkspaceSandbox({
        workspaceId: 'ws-1',
        userId: 'user-1',
        name,
        language: 'python',
        dependencies: [],
      })

      expect(result).toEqual({ ok: false, failure: { code: 'invalid_name', message } })
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('trims a create name before storing it', async () => {
      queueTableRows(workspaceSandbox, []) // name-taken pre-check
      queueTableRows(workspaceSandbox, [{ ...existingRow, name: 'data-tools' }]) // read-back

      await createWorkspaceSandbox({
        workspaceId: 'ws-1',
        userId: 'user-1',
        name: '  data-tools  ',
        language: 'python',
        dependencies: [],
      })

      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'data-tools' })
      )
    })

    /**
     * The regression this guards: `nextName = name ?? existing.name` treated a
     * whitespace-only name as "supplied", so it trimmed to empty, skipped the
     * conflict pre-check (falsy), and wrote an unnamed sandbox the UI cannot
     * create and the user cannot select.
     */
    it('refuses a whitespace-only name on edit instead of writing it', async () => {
      queueTableRows(workspaceSandbox, [existingRow])

      const result = await updateWorkspaceSandbox({
        workspaceId: 'ws-1',
        sandboxId: 'sb-1',
        name: '   ',
      })

      expect(result).toEqual({
        ok: false,
        failure: { code: 'invalid_name', message: 'Name is required' },
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('keeps the stored name when the edit omits one', async () => {
      queueTableRows(workspaceSandbox, [existingRow])
      queueTableRows(workspaceSandbox, [existingRow])

      await updateWorkspaceSandbox({
        workspaceId: 'ws-1',
        sandboxId: 'sb-1',
        dependencies: ['requests', 'httpx'],
      })

      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'data-tools' })
      )
    })
  })

  it('reports a missing sandbox on edit', async () => {
    queueTableRows(workspaceSandbox, [])

    const result = await updateWorkspaceSandbox({
      workspaceId: 'ws-1',
      sandboxId: 'sb-missing',
      name: 'renamed',
    })

    expect(result).toEqual({
      ok: false,
      failure: { code: 'not_found', sandboxId: 'sb-missing' },
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('refuses a dependency the language rejects, with the offending line', async () => {
    const result = await createWorkspaceSandbox({
      workspaceId: 'ws-1',
      userId: 'user-1',
      name: 'data-tools',
      language: 'python',
      dependencies: ['requests', 'not a package!'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('invalid_dependencies')
    if (result.failure.code !== 'invalid_dependencies') return
    expect(result.failure.issues[0]).toMatchObject({ line: 2, value: 'not a package!' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
