import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteRecord } from '@/main/browser-sites/directory'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

const { SiteDirectory } = await import('@/main/browser-sites/directory')

/**
 * The cap is module-private, so it is read back out of the source instead of
 * copied here. A hardcoded `500` would keep passing on the one day the
 * assertion matters — the day someone changes the cap.
 */
const MAX_SITES = Number(
  /MAX_SITES = (\d+)/.exec(await readFile(new URL('directory.ts', import.meta.url), 'utf8'))?.[1]
)
if (!Number.isInteger(MAX_SITES)) throw new Error('could not read MAX_SITES out of directory.ts')

/** Reversible stand-in for the OS keychain, so tests assert real round-trips. */
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^sealed:/, ''),
}

/** `count` distinct hosts numbered from `from`, each as used as `visits` says. */
const sites = (count: number, visits: (index: number) => number, from = 0): SiteRecord[] =>
  Array.from({ length: count }, (_, offset) => ({
    hostname: `site-${String(from + offset).padStart(4, '0')}.example.com`,
    visits: visits(from + offset),
  }))

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

  it('keeps sites from concurrent imports', async () => {
    const store = open()

    await Promise.all([
      store.remember([{ hostname: 'github.com', name: 'GitHub' }]),
      store.remember([{ hostname: 'linear.app', name: 'Linear' }]),
    ])

    expect((await store.list()).map((site) => site.hostname).sort()).toEqual([
      'github.com',
      'linear.app',
    ])
  })

  it('applies concurrent imports and clear in invocation order', async () => {
    const store = open()

    await Promise.all([
      store.remember([{ hostname: 'github.com', name: 'GitHub' }]),
      store.clear(),
      store.remember([{ hostname: 'linear.app', name: 'Linear' }]),
    ])

    expect(await store.list()).toEqual([{ hostname: 'linear.app', name: 'Linear' }])
  })

  it('keeps the busiest profile’s visit count when a host is imported twice', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', name: 'GitHub', visits: 300 }])
    await store.remember([{ hostname: 'github.com', visits: 2 }])

    expect(await store.list()).toEqual([{ hostname: 'github.com', name: 'GitHub', visits: 300 }])
  })

  it('evicts the least-used sites and keeps the most-used ones', async () => {
    const overflow = 20
    await open().remember(sites(MAX_SITES + overflow, (index) => index))

    const kept = new Set((await open().list()).map((site) => site.hostname))
    expect(kept.size).toBe(MAX_SITES)
    expect([...kept].sort()[0]).toBe(`site-${String(overflow).padStart(4, '0')}.example.com`)
    expect(kept).toContain(`site-${String(MAX_SITES + overflow - 1).padStart(4, '0')}.example.com`)
    expect(kept).not.toContain('site-0000.example.com')
    expect(kept).not.toContain(`site-${String(overflow - 1).padStart(4, '0')}.example.com`)
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

  it('preserves a corrupt file until clear explicitly resets persistence', async () => {
    const original = 'not json at all'
    await writeFile(path, original)
    const store = open()

    expect(await store.list()).toEqual([])
    expect(store.isAvailable()).toBe(false)
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])
    expect(await readFile(path, 'utf8')).toBe(original)

    const clearing = store.clear()
    const remembering = store.remember([{ hostname: 'github.com', name: 'GitHub' }])
    await Promise.all([clearing, remembering])
    expect(store.isAvailable()).toBe(true)
    expect(await store.list()).toEqual([{ hostname: 'github.com', name: 'GitHub' }])
  })

  it('does not overwrite a directory written by a future version', async () => {
    const original = JSON.stringify({ version: 99, payload: 'whatever' })
    await writeFile(path, original)
    const store = open()

    expect(await store.list()).toEqual([])
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])
    expect(await readFile(path, 'utf8')).toBe(original)
  })
})
