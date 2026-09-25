import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { open, rename, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSER_FILE_TRANSFER_MAX_BYTES } from '@sim/browser-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { app, type Session } from 'electron'
import {
  discardStagedUploads,
  saveDownloadToWorkspace,
  stageUploadFiles,
} from '@/main/browser-agent/file-transfer'
import { LocalFilesystemService } from '@/main/local-filesystem'

let temp: string
const signal = new AbortController().signal

function appSession(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  return { origin: 'https://sim.test', session: { fetch } as unknown as Session }
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'sim-file-transfer-'))
  vi.mocked(app.getPath).mockReturnValue(temp)
})

afterEach(async () => {
  await rm(temp, { recursive: true, force: true })
})

describe('stageUploadFiles', () => {
  it('stages workspace files from the claimed call and local files by copy, in order', async () => {
    const local = join(temp, 'granted.txt')
    writeFileSync(local, 'local bytes')
    const fetch = vi.fn(
      async () =>
        new Response('workspace bytes', {
          headers: { 'content-disposition': "attachment; filename*=UTF-8''Q3%20plan.pdf" },
        })
    )

    const staged = await stageUploadFiles({
      scopeId: 'chat-1',
      toolCallId: 'call-1',
      paths: ['files/Q3 plan.pdf', 'user-local/Docs--m1/granted.txt'],
      appSession: appSession(fetch),
      localFiles: {
        resolveGrantedFile: vi.fn(async () => ({
          handle: await open(local, 'r'),
          name: 'granted.txt',
          size: 11,
        })),
      },
      signal,
    })

    expect(fetch).toHaveBeenCalledWith('https://sim.test/api/desktop/tool/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId: 'call-1', index: 0 }),
      signal,
    })
    expect(staged.map((path) => path.split('/').pop())).toEqual(['Q3 plan.pdf', 'granted.txt'])
    expect(readFileSync(staged[0], 'utf8')).toBe('workspace bytes')
    expect(readFileSync(staged[1], 'utf8')).toBe('local bytes')
    expect(staged.every((path) => path.startsWith(join(temp, 'sim-browser-uploads')))).toBe(true)
  })

  it('keeps a hostile server file name inside the staging directory', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('x', {
          headers: { 'content-disposition': 'attachment; filename="../../evil"' },
        })
    )

    const [staged] = await stageUploadFiles({
      scopeId: '../scope',
      toolCallId: '../call',
      paths: ['files/a'],
      appSession: appSession(fetch),
      localFiles: undefined,
      signal,
    })

    expect(staged.startsWith(join(temp, 'sim-browser-uploads'))).toBe(true)
    expect(staged.endsWith('/evil')).toBe(true)
  })

  it('reports an app refusal and discards partial staging', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'File not found' }, { status: 404 }))

    await expect(
      stageUploadFiles({
        scopeId: 'chat-1',
        toolCallId: 'call-2',
        paths: ['files/missing.pdf'],
        appSession: appSession(fetch),
        localFiles: undefined,
        signal,
      })
    ).rejects.toThrow('Could not read that workspace file (File not found).')
  })

  it('refuses a workspace file over the transfer ceiling', async () => {
    const oversized = new Uint8Array(BROWSER_FILE_TRANSFER_MAX_BYTES + 1)
    const fetch = vi.fn(async () => new Response(oversized))

    await expect(
      stageUploadFiles({
        scopeId: 'chat-1',
        toolCallId: 'call-3',
        paths: ['files/huge.bin'],
        appSession: appSession(fetch),
        localFiles: undefined,
        signal,
      })
    ).rejects.toThrow(/upload limit/)
  })

  it('bounds a local file that grows after validation and discards every staged file', async () => {
    const local = join(temp, 'growing.bin')
    writeFileSync(local, 'initial')
    const handle = await open(local, 'r')
    const size = (await handle.stat()).size
    await truncate(local, BROWSER_FILE_TRANSFER_MAX_BYTES + 1)

    try {
      await expect(
        stageUploadFiles({
          scopeId: 'chat-growing',
          toolCallId: 'call-growing',
          paths: ['files/first.txt', 'user-local/Docs--m1/growing.bin'],
          appSession: appSession(async () => new Response('already staged')),
          localFiles: {
            resolveGrantedFile: async () => ({ handle, name: 'growing.bin', size }),
          },
          signal,
        })
      ).rejects.toThrow(/upload limit/)
      expect(existsSync(join(temp, 'sim-browser-uploads/chat-growing/call-growing'))).toBe(false)
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it('copies the pinned local file when its path is replaced after validation', async () => {
    const local = join(temp, 'granted.txt')
    writeFileSync(local, 'granted bytes')
    const handle = await open(local, 'r')
    await rename(local, join(temp, 'original.txt'))
    writeFileSync(local, 'replacement bytes')

    try {
      const [staged] = await stageUploadFiles({
        scopeId: 'chat-pinned',
        toolCallId: 'call-pinned',
        paths: ['user-local/Docs--m1/granted.txt'],
        appSession: undefined,
        localFiles: {
          resolveGrantedFile: async () => ({ handle, name: 'granted.txt', size: 13 }),
        },
        signal,
      })

      expect(readFileSync(staged, 'utf8')).toBe('granted bytes')
      expect(handle.fd).toBe(-1)
    } finally {
      await handle.close()
    }
  })

  it('closes a local handle and discards staging when the upload is cancelled', async () => {
    const local = join(temp, 'cancelled.txt')
    writeFileSync(local, 'local bytes')
    const handle = await open(local, 'r')
    const controller = new AbortController()
    controller.abort()

    try {
      await expect(
        stageUploadFiles({
          scopeId: 'chat-cancelled',
          toolCallId: 'call-cancelled',
          paths: ['user-local/Docs--m1/cancelled.txt'],
          appSession: undefined,
          localFiles: {
            resolveGrantedFile: async () => ({ handle, name: 'cancelled.txt', size: 11 }),
          },
          signal: controller.signal,
        })
      ).rejects.toThrow(/aborted/)
      expect(handle.fd).toBe(-1)
      expect(existsSync(join(temp, 'sim-browser-uploads/chat-cancelled/call-cancelled'))).toBe(
        false
      )
    } finally {
      await handle.close()
    }
  })

  it.runIf(process.platform !== 'win32')(
    'preserves a granted POSIX backslash filename when staging',
    async () => {
      const name = 'report\\draft.txt'
      writeFileSync(join(temp, name), 'draft bytes')
      const localFiles = new LocalFilesystemService({ chooseDirectory: async () => temp })
      const grant = await localFiles.handle({ operation: 'mount_directory' })
      if (!grant.ok || !('mount' in grant.data) || !grant.data.mount) {
        throw new Error('Expected a granted directory')
      }
      const mount = grant.data.mount

      try {
        const [staged] = await stageUploadFiles({
          scopeId: 'chat-backslash',
          toolCallId: 'call-backslash',
          paths: [
            `user-local/${encodeURIComponent(mount.name)}--${mount.id}/${encodeURIComponent(name)}`,
          ],
          appSession: undefined,
          localFiles,
          signal,
        })

        expect(staged).toBe(join(temp, 'sim-browser-uploads/chat-backslash/call-backslash/0', name))
        expect(readFileSync(staged, 'utf8')).toBe('draft bytes')
      } finally {
        localFiles.close()
      }
    }
  )

  it('requires a granted-folder source for user-local paths', async () => {
    await expect(
      stageUploadFiles({
        scopeId: 'chat-1',
        toolCallId: 'call-4',
        paths: ['user-local/Docs--m1/a.txt'],
        appSession: undefined,
        localFiles: undefined,
        signal,
      })
    ).rejects.toThrow('Local folders are unavailable')
  })

  it('discards a scope staging directory', async () => {
    const fetch = vi.fn(async () => new Response('x'))
    const [staged] = await stageUploadFiles({
      scopeId: 'chat-9',
      toolCallId: 'call-9',
      paths: ['files/a.txt'],
      appSession: appSession(fetch),
      localFiles: undefined,
      signal,
    })

    await discardStagedUploads('chat-9')

    expect(() => readFileSync(staged)).toThrow()
  })
})

describe('saveDownloadToWorkspace', () => {
  it('stores the download under its claimed call and returns the workspace path', async () => {
    const file = join(temp, 'report.csv')
    writeFileSync(file, 'a,b\n1,2\n')
    const fetch = vi.fn(async () =>
      Response.json({ path: 'files/report.csv', name: 'report.csv', size: 8 })
    )

    const saved = await saveDownloadToWorkspace({
      appSession: appSession(fetch),
      toolCallId: 'call-5',
      filePath: file,
      filename: 'report.csv',
      signal,
    })

    expect(saved).toEqual({ path: 'files/report.csv', name: 'report.csv', size: 8 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sim.test/api/desktop/tool/file?toolCallId=call-5&name=report.csv')
    expect(init.method).toBe('PUT')
    expect(await new Response(init.body).text()).toBe('a,b\n1,2\n')
  })

  it('surfaces the app error message', async () => {
    const file = join(temp, 'report.csv')
    writeFileSync(file, 'x')
    const fetch = vi.fn(async () => Response.json({ error: 'Storage limit' }, { status: 402 }))

    await expect(
      saveDownloadToWorkspace({
        appSession: appSession(fetch),
        toolCallId: 'call-6',
        filePath: file,
        filename: 'report.csv',
        signal,
      })
    ).rejects.toThrow('Could not save the download (Storage limit).')
  })
})
