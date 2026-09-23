import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { executeLocalFileRequest } from '@/main/local-files'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sim-native-files-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('reads an ordinary OS path without mounting or granting a folder, with bounded text pagination', async () => {
  const path = join(root, 'notes.txt')
  await writeFile(path, 'hello world')
  const result = await executeLocalFileRequest(
    { operation: 'read', toolCallId: 'read', path: '/untrusted' },
    { toolName: 'read_local_file', args: { path, offset: 6, limit: 5 } }
  )
  expect(result).toEqual({
    ok: true,
    data: {
      kind: 'read',
      path,
      representation: 'text',
      text: 'world',
      offset: 6,
      nextOffset: 11,
      truncated: false,
    },
  })
  const listing = await executeLocalFileRequest(
    { operation: 'read' },
    { toolName: 'read_local_file', args: { path: root } }
  )
  expect(listing).toMatchObject({
    ok: true,
    data: { representation: 'directory', entries: [{ name: 'notes.txt', kind: 'file' }] },
  })
})

it('returns actual image and bounded PDF observations instead of base64 text', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
    'base64'
  )
  const imagePath = join(root, 'image.png')
  await writeFile(imagePath, png)
  expect(
    await executeLocalFileRequest(
      { operation: 'read' },
      { toolName: 'read_local_file', args: { path: imagePath } }
    )
  ).toMatchObject({
    ok: true,
    data: {
      representation: 'visual',
      observations: [{ mediaType: 'image/png', data: png.toString('base64') }],
    },
  })
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 22; i++) pdf.addPage()
  const path = join(root, 'pages.pdf')
  await writeFile(path, await pdf.save())
  const response = await executeLocalFileRequest(
    { operation: 'read' },
    { toolName: 'read_local_file', args: { path } }
  )
  expect(response).toMatchObject({
    ok: true,
    data: {
      representation: 'visual',
      truncated: true,
      observations: [{ mediaType: 'application/pdf', pageCount: 20 }],
    },
  })
  if (!response.ok || response.data.kind !== 'read' || !response.data.observations?.[0])
    throw new Error('Missing PDF observation')
  expect(
    (
      await PDFDocument.load(Buffer.from(response.data.observations[0].data, 'base64'))
    ).getPageCount()
  ).toBe(20)
})

it('preserves nested and empty directories, imports binary bytes and detects changed files', async () => {
  await mkdir(join(root, 'empty'))
  await mkdir(join(root, 'nested'))
  const path = join(root, 'nested', 'bytes.bin')
  const bytes = Buffer.from([0, 1, 2, 255])
  await writeFile(path, bytes)
  const authorization = {
    toolName: 'import_local_files',
    args: { path: root, targetWorkspaceId: 'target' },
  }
  const result = await executeLocalFileRequest({ operation: 'manifest' }, authorization)
  if (!result.ok || result.data.kind !== 'manifest') throw new Error('Expected manifest')
  expect(result.data.entries.map((entry) => entry.relativePath)).toEqual([
    '',
    'empty',
    'nested',
    'nested/bytes.bin',
  ])
  const entry = result.data.entries.at(-1)!
  expect(
    await executeLocalFileRequest(
      { operation: 'chunk', relativePath: entry.relativePath, revision: entry.revision, offset: 0 },
      authorization
    )
  ).toEqual({ ok: true, data: { kind: 'chunk', bytes: new Uint8Array(bytes), eof: true } })
  await writeFile(path, 'changed')
  expect(
    await executeLocalFileRequest(
      { operation: 'chunk', relativePath: entry.relativePath, revision: entry.revision, offset: 0 },
      authorization
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('changed') })
  expect(
    await executeLocalFileRequest(
      { operation: 'chunk', relativePath: '../other', revision: entry.revision, offset: 0 },
      authorization
    )
  ).toMatchObject({ ok: false, error: expect.stringContaining('outside this import') })
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

it.each(['é', '界', '😀', '\uFEFF'])(
  'preserves %s across the default text-page boundary',
  async (character) => {
    const path = join(root, 'unicode.txt')
    const prefix = 'a'.repeat(63_999)
    const content = `${prefix}${character}end`
    await writeFile(path, content)
    const first = await executeLocalFileRequest(
      { operation: 'read' },
      {
        toolName: 'read_local_file',
        args: { path },
      }
    )
    expect(first).toMatchObject({
      ok: true,
      data: {
        representation: 'text',
        text: prefix,
        offset: 0,
        nextOffset: 63_999,
        truncated: true,
      },
    })
    if (!first.ok || first.data.kind !== 'read') throw new Error('Expected text')
    const second = await executeLocalFileRequest(
      { operation: 'read' },
      {
        toolName: 'read_local_file',
        args: { path, offset: first.data.nextOffset },
      }
    )
    expect(second).toMatchObject({
      ok: true,
      data: {
        representation: 'text',
        text: `${character}end`,
        nextOffset: Buffer.byteLength(content),
        truncated: false,
      },
    })
  }
)

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
