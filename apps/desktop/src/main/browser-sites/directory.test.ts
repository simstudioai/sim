import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const { SiteDirectory } = await import('@/main/browser-sites/directory')

/** Reversible stand-in for the OS keychain, so tests assert real round-trips. */
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^sealed:/, ''),
}

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-site-directory-'))
  path = join(directory, 'browser-sites.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const open = () => new SiteDirectory(path, encryption)

describe('SiteDirectory', () => {
  it('remembers a site’s name and icon across restarts', async () => {
    await open().remember([{ hostname: 'mail.google.com', name: 'Gmail', icon: 'data:png' }])

    expect(await open().list()).toEqual([
      { hostname: 'mail.google.com', name: 'Gmail', icon: 'data:png' },
    ])
  })

  it('refreshes a site that has been renamed', async () => {
    const store = open()
    await store.remember([{ hostname: 'x.com', name: 'Twitter' }])
    await store.remember([{ hostname: 'x.com', name: 'X' }])

    expect(await store.list()).toEqual([{ hostname: 'x.com', name: 'X' }])
  })

  it('keeps sites a later import says nothing about', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])
    await store.remember([{ hostname: 'linear.app', name: 'Linear' }])

    expect((await store.list()).map((site) => site.hostname).sort()).toEqual([
      'github.com',
      'linear.app',
    ])
  })

  it('keeps an existing icon when a later import only learns a name', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', icon: 'data:png' }])
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])

    expect(await store.list()).toEqual([
      { hostname: 'github.com', name: 'GitHub', icon: 'data:png' },
    ])
  })

  it('never writes the site list in the clear', async () => {
    await open().remember([{ hostname: 'mail.google.com', name: 'Gmail' }])

    // Which sites someone uses is exactly what this file must not leak.
    expect((await readFile(path)).toString('utf8')).not.toContain('mail.google.com')
  })

  it('stores nothing at all when the OS cannot encrypt', async () => {
    const unavailable = new SiteDirectory(path, {
      ...encryption,
      isEncryptionAvailable: () => false,
    })

    await unavailable.remember([{ hostname: 'github.com', name: 'GitHub' }])

    expect(await unavailable.list()).toEqual([])
    await expect(readFile(path)).rejects.toThrow()
  })

  it('reads as empty rather than throwing on a corrupt file', async () => {
    await writeFile(path, 'not json at all')

    expect(await open().list()).toEqual([])
  })

  it('ignores a directory written by a future version', async () => {
    await writeFile(path, JSON.stringify({ version: 99, payload: 'whatever' }))

    expect(await open().list()).toEqual([])
  })

  it('skips an entry with no hostname to key it by', async () => {
    await open().remember([{ hostname: '', name: 'Nowhere' }])

    expect(await open().list()).toEqual([])
  })

  it('forgets everything on clear', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])

    await store.clear()

    expect(await store.list()).toEqual([])
  })

  it('clears cleanly when there is nothing to clear', async () => {
    await expect(open().clear()).resolves.toBeUndefined()
  })
})
