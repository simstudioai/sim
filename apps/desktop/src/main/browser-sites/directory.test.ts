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

  it('remembers how used a site was and when it was imported', async () => {
    await open().remember([
      {
        hostname: 'mail.google.com',
        name: 'Gmail',
        visits: 412,
        importedAt: '2026-07-27T09:15:00.000Z',
      },
    ])

    expect(await open().list()).toEqual([
      {
        hostname: 'mail.google.com',
        name: 'Gmail',
        visits: 412,
        importedAt: '2026-07-27T09:15:00.000Z',
      },
    ])
  })

  it('keeps the busiest profile’s visit count when a host is imported twice', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', name: 'GitHub', visits: 300 }])
    await store.remember([{ hostname: 'github.com', visits: 2 }])

    expect(await store.list()).toEqual([{ hostname: 'github.com', name: 'GitHub', visits: 300 }])
  })

  it('raises a visit count when a later profile used the site more', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', visits: 2 }])
    await store.remember([{ hostname: 'github.com', visits: 300 }])

    expect(await store.list()).toEqual([{ hostname: 'github.com', visits: 300 }])
  })

  it('keeps a known visit count when a later import measures nothing', async () => {
    const store = open()
    await store.remember([{ hostname: 'github.com', visits: 300 }])
    await store.remember([{ hostname: 'github.com', name: 'GitHub' }])

    expect(await store.list()).toEqual([{ hostname: 'github.com', name: 'GitHub', visits: 300 }])
  })

  it('stops at the cap when two imports together overflow it', async () => {
    const store = open()
    const perImport = Math.ceil(MAX_SITES * 0.6)
    expect(perImport * 2).toBeGreaterThan(MAX_SITES)

    await store.remember(sites(perImport, () => 10))
    await store.remember(sites(perImport, () => 10, perImport))

    expect(await store.list()).toHaveLength(MAX_SITES)
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

  it('evicts a site with no measured use before one with any', async () => {
    // No usage evidence must not outrank measured usage: treating a missing
    // count as infinitely used would evict a real site to keep this one.
    await open().remember([{ hostname: 'unmeasured.example.com' }, ...sites(MAX_SITES, () => 1)])

    const kept = (await open().list()).map((site) => site.hostname)
    expect(kept).toHaveLength(MAX_SITES)
    expect(kept).not.toContain('unmeasured.example.com')
    expect(kept).toContain('site-0000.example.com')
  })

  it('evicts the same record no matter what order the records arrived in', async () => {
    const tied: SiteRecord[] = [
      { hostname: 'tie-a.example.com', visits: 5, importedAt: '2026-01-01T00:00:00.000Z' },
      { hostname: 'tie-b.example.com', visits: 5, importedAt: '2026-02-01T00:00:00.000Z' },
      { hostname: 'tie-c.example.com', visits: 5, importedAt: '2026-02-01T00:00:00.000Z' },
    ]
    const busier = sites(MAX_SITES - 1, () => 100)

    const survivors = await Promise.all(
      [[...busier, ...tied], [...tied].reverse().concat(busier)].map(async (records, index) => {
        const store = new SiteDirectory(join(directory, `order-${index}.json`), encryption)
        await store.remember(records)
        return (await store.list())
          .map((site) => site.hostname)
          .filter((hostname) => hostname.startsWith('tie-'))
      })
    )

    // One slot, three equally used hosts: the newer import wins, and hostname
    // settles what is left — `tie-b` and `tie-c` share an import time.
    expect(survivors).toEqual([['tie-b.example.com'], ['tie-b.example.com']])
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

  it('drops a directory written before imported hosts became suggestions', async () => {
    // Version 1 was seeded from imported cookie hosts — mostly ad and analytics
    // origins — and those records only ever decorated a host the omnibox already
    // had. Version 2 records are offered as suggestions in their own right, so
    // carrying the old set forward would put exactly those origins in the
    // dropdown. The payload below decrypts cleanly; it is discarded on meaning,
    // not on damage.
    const version1: SiteRecord[] = [{ hostname: 'doubleclick.net', name: 'DoubleClick' }]
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        payload: encryption.encryptString(JSON.stringify(version1)).toString('base64'),
      })
    )

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
