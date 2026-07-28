import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { LocalFilesystemMount, LocalFilesystemResponse } from '@sim/desktop-bridge'
import {
  DEFAULT_GREP_CONTEXT,
  DEFAULT_GREP_RESULTS,
  DEFAULT_READ_LINES,
} from '@sim/desktop-bridge/local-filesystem-limits'
import { shell } from 'electron'
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

  it('reports an invalid grep regex instead of claiming there are no matches', async () => {
    const granted = await mount(service)

    const response = await service.handle({
      operation: 'grep',
      uri: granted.uri,
      pattern: '([unclosed',
    })

    // Returning an empty match set would tell the model the string appears
    // nowhere in the user's files, which it would then act on as fact.
    expect(response.ok).toBe(false)
  })

  it('still accepts the glob patterns people actually write', async () => {
    const granted = await mount(service)

    for (const pattern of ['**/*.ts', 'src/**/*.tsx', '**/node_modules/**', '**/*spec*']) {
      const response = await service.handle({ operation: 'glob', uri: granted.uri, pattern })
      expect(response.ok).toBe(true)
    }
  })

  it('lists, reads, globs, greps, and stats inside the selected directory', async () => {
    const granted = await mount(service)

    const listData = dataOf(await service.handle({ operation: 'list', uri: granted.uri }))
    expect('entries' in listData && listData.entries.map((entry) => entry.name)).toEqual([
      'README.md',
      'src',
    ])

    const readData = dataOf(
      await service.handle({
        operation: 'read',
        uri: `${granted.uri}README.md`,
        startLine: 2,
        lineCount: 1,
      })
    )
    expect(readData).toMatchObject({ content: 'second line', startLine: 2, endLine: 2 })

    const globData = dataOf(
      await service.handle({ operation: 'glob', uri: granted.uri, pattern: '**/*.ts' })
    )
    expect(
      'entries' in globData && globData.entries.map((entry) => entry.uri.replace(granted.uri, ''))
    ).toEqual(['src/index.ts'])

    const grepData = dataOf(
      await service.handle({
        operation: 'grep',
        uri: granted.uri,
        query: 'ANSWER',
        include: '**/*.ts',
      })
    )
    expect(grepData).toMatchObject({
      matches: [{ line: 1, text: 'export const answer = 42' }],
    })

    const statData = dataOf(
      await service.handle({ operation: 'stat', uri: `${granted.uri}src/index.ts` })
    )
    expect(statData).toMatchObject({ name: 'index.ts', kind: 'file' })
  })

  it('supports the normal VFS grep regex and output modes', async () => {
    const granted = await mount(service)

    const content = dataOf(
      await service.handle({
        operation: 'grep',
        uri: granted.uri,
        pattern: 'hello|answer\\s*=\\s*42',
        outputMode: 'content',
        caseSensitive: true,
        maxResults: 10,
      })
    )
    expect(content).toMatchObject({
      matches: [
        { uri: `${granted.uri}README.md`, line: 1, text: 'hello world' },
        { uri: `${granted.uri}src/index.ts`, line: 1, text: 'export const answer = 42' },
      ],
    })

    const files = dataOf(
      await service.handle({
        operation: 'grep',
        uri: granted.uri,
        pattern: 'second line',
        outputMode: 'files_with_matches',
      })
    )
    expect(files).toEqual({ files: [`${granted.uri}README.md`], truncated: false })

    const counts = dataOf(
      await service.handle({
        operation: 'grep',
        uri: `${granted.uri}README.md`,
        pattern: 'line',
        outputMode: 'count',
      })
    )
    expect(counts).toEqual({
      counts: [{ uri: `${granted.uri}README.md`, count: 1 }],
      truncated: false,
    })
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

  it('cancels a native scan by request id', async () => {
    const granted = await mount(service)
    for (let index = 0; index < 200; index++) {
      await writeFile(join(root, `file-${index}.txt`), `line ${index}\n`)
    }

    const pending = service.handle({
      operation: 'grep',
      uri: granted.uri,
      pattern: 'never-matches',
      requestId: 'tool-abort',
    })
    const cancelled = dataOf(await service.handle({ operation: 'cancel', requestId: 'tool-abort' }))
    expect(cancelled).toEqual({ cancelled: true })
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
  })

  it('does not expose a raw-byte read operation', async () => {
    const granted = await mount(service)
    await expect(
      service.handle({ operation: 'read_file_bytes', uri: `${granted.uri}README.md` })
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' })
  })

  it('authorizes a request whose omitted args resolved to the shared defaults', async () => {
    // The failure mode this guards is silent: with an arg omitted there is no
    // value on the wire to disagree about, only two defaulting tables — the
    // renderer's, resolving what to send, and the authorizer's, resolving what
    // to expect. If they drift, a legitimate tool call is DENIED rather than
    // erroring. Both now read these from @sim/desktop-bridge; this pins the
    // authorizer half to them.
    const granted = await mount(service)
    const vfsRoot = `user-local/${encodeURIComponent(granted.name)}--${granted.id}`

    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'read',
          uri: `${granted.uri}README.md`,
          startLine: 1,
          lineCount: DEFAULT_READ_LINES,
          requestId: 'read-defaults',
        },
        { toolName: 'read', args: { path: `${vfsRoot}/README.md` } }
      )
    ).toBe(true)

    expect(
      service.isAuthorizedClientToolRequest(
        {
          operation: 'grep',
          uri: granted.uri,
          pattern: 'TODO',
          caseSensitive: true,
          outputMode: 'content',
          lineNumbers: true,
          context: DEFAULT_GREP_CONTEXT,
          maxResults: DEFAULT_GREP_RESULTS,
          requestId: 'grep-defaults',
        },
        { toolName: 'grep', args: { path: 'user-local', pattern: 'TODO' } }
      )
    ).toBe(true)
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

  it('rejects lexical traversal before URL normalization can reinterpret it', async () => {
    const granted = await mount(service)
    const traversal = await service.handle({
      operation: 'read',
      uri: `${granted.uri}../README.md`,
    })

    expect(traversal).toMatchObject({ ok: false, code: 'ACCESS_DENIED' })
  })

  it('reads a child whose name merely starts with dots', async () => {
    // The containment check compares path SEGMENTS. Testing the two leading
    // characters instead denies real files: `..config` is an ordinary name,
    // not a walk out of the root.
    await writeFile(join(root, '..config'), 'kept\n')
    const granted = await mount(service)

    const response = await service.handle({
      operation: 'read',
      uri: `${granted.uri}..config`,
    })

    expect(response.ok).toBe(true)
  })

  it('clears all grants without touching files on disk', async () => {
    const granted = await mount(service)
    service.close()

    const response = await service.handle({ operation: 'stat', uri: granted.uri })
    expect(response).toMatchObject({ ok: false, code: 'MOUNT_NOT_FOUND' })
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

  it('keeps a grant session-only when secure persistence is unavailable', async () => {
    const grantStore: LocalFilesystemGrantStore = {
      load: async () => [],
      save: async () => false,
      clear: async () => {},
    }
    const sessionService = new LocalFilesystemService({
      chooseDirectory: async () => root,
      grantStore,
    })

    expect(await mount(sessionService)).toMatchObject({ remembered: false })
  })

  it('shows a granted folder in the file manager, and only a granted one', async () => {
    const granted = await mount(service)

    expect(dataOf(await service.handle({ operation: 'reveal_mount', uri: granted.uri }))).toEqual({
      revealed: true,
    })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(await realpath(root))

    const unknown = await service.handle({
      operation: 'reveal_mount',
      uri: 'localfs://not-a-mount/',
    })
    expect(unknown.ok).toBe(false)
    expect(shell.showItemInFolder).toHaveBeenCalledOnce()
  })
})
