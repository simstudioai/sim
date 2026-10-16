/** @vitest-environment node */

import { flushMacrotask } from '@sim/testing/helpers/async'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { list, textRead } = vi.hoisted(() => ({ list: vi.fn(), textRead: vi.fn() }))
vi.mock('@/lib/projects/files/application', () => ({
  listProjectFiles: { execute: list },
  readProjectFileText: { execute: textRead },
}))
vi.mock('@/lib/mothership/application/execute-project-file-use-case', () => ({
  executeCopilotProjectFileUseCase: (
    _context: unknown,
    useCase: { execute(input: unknown): Promise<unknown> },
    input: unknown
  ) => useCase.execute(input),
}))

import { MAX_GREP_FILES } from '@/lib/mothership/agent-cli/engines/universal-grep'
import { grepProjectFiles } from '@/lib/mothership/agent-cli/project-file-grep'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const invocation = {
  kind: 'augmentation' as const,
  name: 'grep',
  positionals: ['needle'],
  flags: { scope: 'files', in: 'files/notes' },
}
const context = () => ({
  userId: 'reader',
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], { userId: 'reader' }),
})
beforeEach(() => {
  list.mockResolvedValue({
    files: [{ id: 'file', name: 'notes.txt', folderPath: '/' }],
    nextKeys: null,
  })
  textRead.mockResolvedValue({
    file: { id: 'file', name: 'notes.txt' },
    contentType: 'text/plain',
    text: 'before\nneedle\nafter',
    truncated: false,
    degraded: false,
    degradedReason: null,
    secretProvenance: { status: 'exact', entries: [] },
  })
})

describe('Project grep corpus', () => {
  it('selects a file on a later inventory page and preserves matching line numbers', async () => {
    list.mockImplementation(async ({ after }: { after?: { value: string }[] }) =>
      after?.[0]?.value === 'cursor'
        ? { files: [{ id: 'file', name: 'notes.txt', folderPath: '/' }], nextKeys: null }
        : {
            files: [{ id: 'other', name: 'unrelated.txt' }],
            nextKeys: [{ value: 'cursor', direction: 'asc' }],
          }
    )
    const result = await grepProjectFiles(invocation, context(), 'project')
    expect(result).toEqual({ exitCode: 0, stdout: 'files/notes.txt (file):2: needle', stderr: '' })
  })
  it.each<Record<string, string | true>>([
    { scope: 'files,workflows' },
    { scope: 'files', in: 'workflows' },
    { scope: '' },
  ])('refuses incompatible Project scope before reading a corpus: %j', async (flags) => {
    const result = await grepProjectFiles({ ...invocation, flags }, context(), 'project')
    expect(result.exitCode).toBe(1)
    expect(list).not.toHaveBeenCalled()
  })
  it('withholds one file without exact source evidence and keeps searching the rest', async () => {
    list.mockResolvedValue({
      files: [
        { id: 'file', name: 'notes.txt', folderPath: '/' },
        { id: 'other', name: 'notes-2.txt', folderPath: '/' },
      ],
      nextKeys: null,
    })
    textRead.mockResolvedValueOnce({
      file: { id: 'file', name: 'notes.txt' },
      contentType: 'text/plain',
      text: 'needle',
      truncated: false,
      degraded: false,
      degradedReason: null,
      secretProvenance: { status: 'unknown' },
    })
    const ctx = context()
    const result = await grepProjectFiles(invocation, ctx, 'project')
    expect(result.stdout).toBe('files/notes-2.txt (other):2: needle')
    expect(result.stderr).toContain('files/notes.txt (file): text withheld without its secret')
    expect(ctx.resolvedSecretTraceRegistry.isPermanentlyIncomplete()).toBe(false)
  })
  it('stops walking the inventory once the file budget is full', async () => {
    list.mockImplementation(async ({ after }: { after?: { value: string }[] }) => ({
      files: Array.from({ length: MAX_GREP_FILES + 1 }, (_, index) => ({
        id: `${after ? 'late' : 'early'}-${index}`,
        name: `notes-${index}.txt`,
        folderPath: '/',
      })),
      nextKeys: after ? null : [{ value: 'cursor', direction: 'asc' }],
    }))
    const result = await grepProjectFiles(invocation, context(), 'project')
    expect(list).toHaveBeenCalledTimes(1)
    expect(result.stderr).toContain(`searched the first ${MAX_GREP_FILES} selected files`)
  })
  it('marks truncated inventory incomplete instead of claiming a missing selector has no matches', async () => {
    list.mockResolvedValue({ files: [], nextKeys: [{ value: 'cursor', direction: 'asc' }] })
    const result = await grepProjectFiles(invocation, context(), 'project')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('listing stopped after 50 pages')
    expect(result.stdout).toBe('')
  })
})

it('reads five Project files concurrently while preserving inventory result order', async () => {
  const gates = Array.from({ length: 6 }, () => createDeferred<void>())
  let active = 0
  let peak = 0
  list.mockResolvedValue({
    files: Array.from({ length: 6 }, (_, index) => ({
      id: `file-${index}`,
      name: `notes-${index}.txt`,
      folderPath: '/',
    })),
    nextKeys: null,
  })
  textRead.mockImplementation(async ({ fileId }: { fileId: string }) => {
    active++
    peak = Math.max(peak, active)
    await gates[Number(fileId.slice(5))].promise
    active--
    return {
      file: { id: fileId, name: `${fileId}.txt` },
      contentType: 'text/plain',
      text: 'needle',
      truncated: false,
      degraded: false,
      degradedReason: null,
      secretProvenance: { status: 'exact', entries: [] },
    }
  })
  const pending = grepProjectFiles(invocation, context(), 'project')
  try {
    await flushMacrotask()
    expect(active).toBe(5)
    for (const index of [4, 3, 2, 1, 0, 5]) {
      gates[index].resolve()
      await flushMacrotask()
    }
  } finally {
    for (const gate of gates) gate.resolve()
    await pending
  }
  const result = await pending
  expect(peak).toBe(5)
  expect(result.stdout.split('\n')).toEqual(
    Array.from({ length: 6 }, (_, index) => `files/notes-${index}.txt (file-${index}):1: needle`)
  )
})
