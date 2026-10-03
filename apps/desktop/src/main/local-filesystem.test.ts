import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

import type { LocalFilesystemMount, LocalFilesystemResponse } from '@sim/desktop-bridge'
import { LocalFilesystemService } from '@/main/local-filesystem'
import type {
  LocalFilesystemGrantStore,
  PersistedLocalFilesystemGrant,
} from '@/main/local-filesystem-grant-store'

class MemoryGrantStore implements LocalFilesystemGrantStore {
  grants: PersistedLocalFilesystemGrant[] = []

  async load(): Promise<PersistedLocalFilesystemGrant[]> {
    return structuredClone(this.grants)
  }

  async save(grants: PersistedLocalFilesystemGrant[]): Promise<boolean> {
    this.grants = structuredClone(grants)
    return true
  }

  async clear(): Promise<void> {
    this.grants = []
  }
}

function dataOf(response: LocalFilesystemResponse) {
  expect(response.ok).toBe(true)
  if (!response.ok) throw new Error(response.error)
  return response.data
}

async function mount(service: LocalFilesystemService): Promise<LocalFilesystemMount> {
  const data = dataOf(await service.handle({ operation: 'mount_directory' }))
  if (!('mount' in data) || !data.mount) throw new Error('Expected a mounted directory')
  return data.mount
}

describe('LocalFilesystemService', () => {
  let root: string
  let service: LocalFilesystemService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sim-localfs-'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'README.md'), 'hello world\nsecond line\n')
    await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42\n')
    service = new LocalFilesystemService({
      chooseDirectory: async () => root,
    })
  })

  it('returns opaque mount metadata without exposing the host path', async () => {
    const granted = await mount(service)
    expect(granted.uri).toMatch(/^localfs:\/\/[^/]+\/$/)
    expect(granted).not.toHaveProperty('path')

    const listData = dataOf(await service.handle({ operation: 'list_mounts' }))
    expect(listData).toEqual({ mounts: [granted] })
  })

  it('refuses glob patterns that would be ruinously expensive to evaluate', async () => {
    const granted = await mount(service)
    // Micromatch backtracking is exponential in wildcard count. Measured
    // against a single 46-character path, the 10-wildcard pattern below took
    // 2.7s and a 12-wildcard one 43s — per scanned entry, in one synchronous
    // call that no abort check can interrupt, on the main process.
    const pathological = ['**/*a*a*a*a*a*b', '**/*a*a*a*a*a*a*a*b', '*'.repeat(40)]

    for (const pattern of pathological) {
      const response = await service.handle({ operation: 'glob', uri: granted.uri, pattern })
      expect(response.ok).toBe(false)
    }
  })

  it('rejects grep regexes with catastrophic-backtracking risk', async () => {
    const granted = await mount(service)
    await expect(
      service.handle({
        operation: 'grep',
        uri: granted.uri,
        pattern: '(a+)+$',
      })
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: expect.stringContaining('catastrophic backtracking'),
    })
  })

  it('binds privileged client reads and searches to server-persisted tool args', async () => {
    const granted = await mount(service)
    const vfsRoot = `user-local/${encodeURIComponent(granted.name)}--${granted.id}`

    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'read',
          uri: `${granted.uri}README.md`,
          startLine: 3,
          lineCount: 25,
          requestId: 'read-tool',
        },
        {
          toolName: 'read',
          args: { path: `${vfsRoot}/README.md`, offset: 2, limit: 25 },
        }
      )
    ).toBe(true)
    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'read',
          uri: `${granted.uri}src/index.ts`,
          startLine: 3,
          lineCount: 25,
          requestId: 'read-tool',
        },
        {
          toolName: 'read',
          args: { path: `${vfsRoot}/README.md`, offset: 2, limit: 25 },
        }
      )
    ).toBe(false)

    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'glob',
          uri: granted.uri,
          pattern: `${vfsRoot}/**/*.ts`,
          pathPrefix: vfsRoot,
          requestId: 'glob-tool',
        },
        { toolName: 'glob', args: { pattern: `${vfsRoot}/**/*.ts` } }
      )
    ).toBe(true)

    const grepAuthorization = {
      toolName: 'grep',
      args: {
        path: 'user-local',
        pattern: 'TODO',
        ignoreCase: true,
        output_mode: 'files_with_matches',
        maxResults: 20,
      },
    }
    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'grep',
          uri: granted.uri,
          pattern: 'TODO',
          caseSensitive: false,
          outputMode: 'files_with_matches',
          lineNumbers: true,
          context: 0,
          maxResults: 20,
          requestId: 'grep-tool',
        },
        grepAuthorization
      )
    ).toBe(true)
    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'grep',
          uri: granted.uri,
          pattern: 'PASSWORD',
          caseSensitive: false,
          outputMode: 'files_with_matches',
          lineNumbers: true,
          context: 0,
          maxResults: 20,
          requestId: 'grep-tool',
        },
        grepAuthorization
      )
    ).toBe(false)

    const authorizedGrepRequest = {
      operation: 'grep',
      uri: granted.uri,
      pattern: 'TODO',
      caseSensitive: false,
      outputMode: 'files_with_matches',
      lineNumbers: true,
      context: 0,
      maxResults: 20,
      requestId: 'grep-tool',
    }

    // A tool call whose args carry no pattern once made the comparison
    // `undefined !== undefined`, so the guard passed and grep fell back to
    // searching the renderer's own `query`.
    expect(
      service.isAuthorizedClientToolRequest(
        { ...authorizedGrepRequest, pattern: undefined, query: 'PASSWORD' },
        { toolName: 'grep', args: { ...grepAuthorization.args, pattern: undefined } }
      )
    ).toBe(false)

    // `query` and `include` are read by grep() but never sent by the authorized
    // path, so smuggling either widens or silently narrows the search.
    expect(
      service.isAuthorizedClientToolRequest(
        { ...authorizedGrepRequest, query: 'PASSWORD' },
        grepAuthorization
      )
    ).toBe(false)
    expect(
      service.isAuthorizedClientToolRequest(
        { ...authorizedGrepRequest, include: '**/nothing-here/**' },
        grepAuthorization
      )
    ).toBe(false)
  })

  it('rejects unknown mounts and symlinks that escape the selected directory', async () => {
    const granted = await mount(service)
    const outside = await mkdtemp(join(tmpdir(), 'sim-localfs-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'secret-link.txt'))

    const missingMount = await service.handle({
      operation: 'read',
      uri: 'localfs://not-granted/file.txt',
    })
    expect(missingMount).toMatchObject({ ok: false, code: 'MOUNT_NOT_FOUND' })

    const escaped = await service.handle({
      operation: 'read',
      uri: `${granted.uri}secret-link.txt`,
    })
    expect(escaped).toMatchObject({ ok: false, code: 'ACCESS_DENIED' })
  })

  it('resolves a granted file for upload and refuses escapes, directories, and oversize files', async () => {
    const granted = await mount(service)
    const vfsRoot = `user-local/${encodeURIComponent(granted.name)}--${granted.id}`
    const outside = await mkdtemp(join(tmpdir(), 'sim-localfs-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'secret-link.txt'))

    const file = await service.resolveGrantedFile(`${vfsRoot}/README.md`, 1024)
    try {
      expect(file).toMatchObject({ name: 'README.md', size: 24 })
      await expect(file.handle.readFile('utf8')).resolves.toBe('hello world\nsecond line\n')
    } finally {
      await file.handle.close()
    }
    await expect(
      service.resolveGrantedFile(`${vfsRoot}/secret-link.txt`, 1024)
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(service.resolveGrantedFile(`${vfsRoot}/src`, 1024)).rejects.toMatchObject({
      code: 'NOT_A_FILE',
    })
    await expect(service.resolveGrantedFile(`${vfsRoot}/README.md`, 4)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    })
    await expect(
      service.resolveGrantedFile('user-local/Other--missing/README.md', 1024)
    ).rejects.toMatchObject({ code: 'MOUNT_NOT_FOUND' })
  })

  it.each(['..', '%2e%2e', 'src%2F..%2FREADME.md', 'README.md%00'])(
    'rejects unsafe upload path segment %s',
    async (segment) => {
      const granted = await mount(service)
      const vfsRoot = `user-local/${encodeURIComponent(granted.name)}--${granted.id}`

      await expect(service.resolveGrantedFile(`${vfsRoot}/${segment}`, 1024)).rejects.toMatchObject(
        {
          code: expect.stringMatching(/^(ACCESS_DENIED|INVALID_URI)$/),
        }
      )
    }
  )

  it.each([false, true])(
    'closes a file opened through a swapped ancestor (ancestor restored: %s)',
    async (restoreAncestor) => {
      const granted = await mount(service)
      const vfsRoot = `user-local/${encodeURIComponent(granted.name)}--${granted.id}`
      const outside = await mkdtemp(join(tmpdir(), 'sim-localfs-outside-'))
      await writeFile(join(outside, 'index.ts'), 'outside secret')
      const sourceDirectory = join(root, 'src')
      const originalDirectory = join(root, 'original-src')
      const openFile = vi.mocked(open).getMockImplementation()
      if (!openFile) throw new Error('Expected the original file-open implementation')
      let opened: FileHandle | undefined
      const openSpy = vi
        .mocked(open)
        .mockClear()
        .mockImplementationOnce(async (...args) => {
          await rename(sourceDirectory, originalDirectory)
          await symlink(outside, sourceDirectory)
          opened = await openFile(...args)
          if (restoreAncestor) {
            await rm(sourceDirectory)
            await rename(originalDirectory, sourceDirectory)
          }
          return opened
        })

      try {
        await expect(
          service.resolveGrantedFile(`${vfsRoot}/src/index.ts`, 1024)
        ).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
        expect(openSpy).toHaveBeenCalledTimes(1)
        expect(opened?.fd).toBe(-1)
      } finally {
        openSpy.mockReset().mockImplementation(openFile)
        await opened?.close()
        await rm(outside, { recursive: true, force: true })
      }
    }
  )

  it('rejects lexical traversal before URL normalization can reinterpret it', async () => {
    const granted = await mount(service)
    const traversal = await service.handle({
      operation: 'read',
      uri: `${granted.uri}../README.md`,
    })

    expect(traversal).toMatchObject({ ok: false, code: 'ACCESS_DENIED' })
  })

  it('does not commit a directory chosen after account teardown starts', async () => {
    const grantStore = new MemoryGrantStore()
    let resolveSelection: ((selection: string) => void) | undefined
    const selection = new Promise<string>((resolve) => {
      resolveSelection = resolve
    })
    const pendingService = new LocalFilesystemService({
      chooseDirectory: () => selection,
      grantStore,
    })

    const pendingMount = pendingService.handle({ operation: 'mount_directory' })
    await pendingService.forgetAll()
    resolveSelection?.(root)

    await expect(pendingMount).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(grantStore.grants).toEqual([])
    expect(dataOf(await pendingService.handle({ operation: 'list_mounts' }))).toEqual({
      mounts: [],
    })
  })

  it('restores an encrypted grant with the same opaque URI after restart', async () => {
    const grantStore = new MemoryGrantStore()
    const firstStopAccessing = vi.fn()
    const firstService = new LocalFilesystemService({
      chooseDirectory: async () => ({ path: root, bookmark: 'bookmark' }),
      grantStore,
      startAccessingBookmark: () => firstStopAccessing,
    })

    const granted = await mount(firstService)
    const canonicalRoot = await realpath(root)
    expect(granted).toMatchObject({ remembered: true })
    expect(grantStore.grants).toMatchObject([
      { id: granted.id, rootPath: canonicalRoot, bookmark: 'bookmark' },
    ])

    firstService.close()
    expect(firstStopAccessing).toHaveBeenCalledOnce()

    const restoredStopAccessing = vi.fn()
    const restoredService = new LocalFilesystemService({
      grantStore,
      startAccessingBookmark: () => restoredStopAccessing,
    })
    await restoredService.initialize()

    const listData = dataOf(await restoredService.handle({ operation: 'list_mounts' }))
    expect(listData).toEqual({ mounts: [granted] })
    const statData = dataOf(
      await restoredService.handle({
        operation: 'stat',
        uri: `${granted.uri}README.md`,
      })
    )
    expect(statData).toMatchObject({ name: 'README.md', kind: 'file' })

    const forgotten = dataOf(
      await restoredService.handle({ operation: 'forget_mount', uri: granted.uri })
    )
    expect(forgotten).toEqual({ forgotten: true })
    expect(restoredStopAccessing).toHaveBeenCalledOnce()
    expect(grantStore.grants).toEqual([])

    const nextLaunch = new LocalFilesystemService({ grantStore })
    await nextLaunch.initialize()
    expect(dataOf(await nextLaunch.handle({ operation: 'list_mounts' }))).toEqual({ mounts: [] })
  })
})
