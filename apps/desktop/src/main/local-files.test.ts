import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { executeLocalFileRequest } from '@/main/local-files'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sim-native-files-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('rejects missing paths and directory cycles with explicit errors before uploading', async () => {
  expect(
    await executeLocalFileRequest(
      { operation: 'read' },
      { toolName: 'read_local_file', args: { path: join(root, 'missing') } }
    )
  ).toMatchObject({ ok: false })
  await symlink(root, join(root, 'cycle'))
  expect(
    await executeLocalFileRequest(
      { operation: 'manifest' },
      { toolName: 'import_local_files', args: { path: root, targetWorkspaceId: 'target' } }
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('cycle') })
})

it('refuses oversized import files before any workspace mutation or bulk allocation', async () => {
  const path = join(root, 'large.bin')
  await writeFile(path, '')
  await truncate(path, 64 * 1024 * 1024 + 1)
  expect(
    await executeLocalFileRequest(
      { operation: 'manifest' },
      { toolName: 'import_local_files', args: { path, targetWorkspaceId: 'workspace' } }
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('64 MB') })
})

it.each(['file', 'directory'] as const)(
  'rejects %s symlinks outside the import source during manifest and chunk reads',
  async (kind) => {
    const source = join(root, 'selected')
    const outside = join(root, 'selected-other')
    await mkdir(source)
    await mkdir(outside)
    await writeFile(join(outside, 'private.txt'), 'outside content')
    const target = kind === 'file' ? join(outside, 'private.txt') : outside
    await symlink(target, join(source, 'link'))
    const authorization = {
      toolName: 'import_local_files',
      args: { path: source, targetWorkspaceId: 'target' },
    }
    expect(await executeLocalFileRequest({ operation: 'manifest' }, authorization)).toMatchObject({
      ok: false,
      error: expect.stringContaining('outside this import source'),
    })
    const outsideManifest = await executeLocalFileRequest(
      { operation: 'manifest' },
      { toolName: 'import_local_files', args: { path: target, targetWorkspaceId: 'target' } }
    )
    if (!outsideManifest.ok || outsideManifest.data.kind !== 'manifest')
      throw new Error('Expected manifest')
    const entry = outsideManifest.data.entries.find((item) => item.kind === 'file')!
    expect(
      await executeLocalFileRequest(
        {
          operation: 'chunk',
          relativePath: kind === 'file' ? 'link' : 'link/private.txt',
          revision: entry.revision,
          offset: 0,
        },
        authorization
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining('outside this import source') })
  }
)

it('supports internal symlinks and an explicitly selected symlink root, but rejects a retargeted child', async () => {
  const source = join(root, 'selected')
  await mkdir(source)
  await writeFile(join(source, 'notes.txt'), 'inside')
  await symlink(join(source, 'notes.txt'), join(source, 'alias.txt'))
  const selectedAlias = join(root, 'selected-alias')
  await symlink(source, selectedAlias)
  const authorization = {
    toolName: 'import_local_files',
    args: { path: selectedAlias, targetWorkspaceId: 'target' },
  }
  const manifest = await executeLocalFileRequest({ operation: 'manifest' }, authorization)
  if (!manifest.ok || manifest.data.kind !== 'manifest') throw new Error('Expected manifest')
  const entry = manifest.data.entries.find((item) => item.relativePath === 'alias.txt')!
  const request = {
    operation: 'chunk',
    relativePath: 'alias.txt',
    revision: entry.revision,
    offset: 0,
  }
  expect(await executeLocalFileRequest(request, authorization)).toEqual({
    ok: true,
    data: { kind: 'chunk', bytes: new Uint8Array(Buffer.from('inside')), eof: true },
  })
  await writeFile(join(root, 'outside.txt'), 'outside')
  await rm(join(source, 'alias.txt'))
  await symlink(join(root, 'outside.txt'), join(source, 'alias.txt'))
  expect(await executeLocalFileRequest(request, authorization)).toMatchObject({
    ok: false,
    error: expect.stringContaining('outside this import source'),
  })
})

it('preserves a UTF-8 BOM and rejects split offsets and limits that cannot fit a character', async () => {
  const path = join(root, 'unicode.txt')
  await writeFile(path, '\uFEFF😀end')
  expect(
    await executeLocalFileRequest(
      { operation: 'read' },
      {
        toolName: 'read_local_file',
        args: { path, limit: 4 },
      }
    )
  ).toMatchObject({ ok: true, data: { text: '\uFEFF', nextOffset: 3, truncated: true } })
  expect(
    await executeLocalFileRequest(
      { operation: 'read' },
      {
        toolName: 'read_local_file',
        args: { path, offset: 4 },
      }
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('UTF-8') })
  expect(
    await executeLocalFileRequest(
      { operation: 'read' },
      {
        toolName: 'read_local_file',
        args: { path, offset: 3, limit: 1 },
      }
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('limit') })
})
