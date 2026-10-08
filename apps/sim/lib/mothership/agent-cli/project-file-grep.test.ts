/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { list, artifact } = vi.hoisted(() => ({ list: vi.fn(), artifact: vi.fn() }))
vi.mock('@/lib/projects/files/application', () => ({
  listProjectFiles: { execute: list },
  readProjectFileArtifact: { execute: artifact },
}))
vi.mock('@/lib/mothership/application/execute-project-file-use-case', () => ({
  executeCopilotProjectFileUseCase: (
    _context: unknown,
    useCase: { execute(input: unknown): Promise<unknown> },
    input: unknown
  ) => useCase.execute(input),
}))

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
  artifact.mockResolvedValue({
    file: { id: 'file', name: 'notes.txt' },
    contentType: 'text/plain',
    buffer: Buffer.from('before\nneedle\nafter'),
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
  it.each([{ scope: 'files,workflows' }, { scope: 'files', in: 'workflows' }, { scope: '' }])(
    'refuses incompatible Project scope before reading a corpus: %j',
    async (flags) => {
      const result = await grepProjectFiles({ ...invocation, flags }, context(), 'project')
      expect(result.exitCode).toBe(1)
      expect(list).not.toHaveBeenCalled()
    }
  )
  it('refuses to match bytes without exact source evidence', async () => {
    artifact.mockResolvedValueOnce({
      file: { id: 'file', name: 'notes.txt' },
      contentType: 'text/plain',
      buffer: Buffer.from('needle'),
      secretProvenance: { status: 'unknown' },
    })
    await expect(grepProjectFiles(invocation, context(), 'project')).rejects.toThrow(
      'secret provenance'
    )
  })
  it('marks truncated inventory incomplete instead of claiming a missing selector has no matches', async () => {
    list.mockResolvedValue({ files: [], nextKeys: [{ value: 'cursor', direction: 'asc' }] })
    const result = await grepProjectFiles(invocation, context(), 'project')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('listing stopped after 50 pages')
    expect(result.stdout).toBe('')
  })
})
