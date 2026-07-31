import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isCoveredByDomain,
  MAX_IMPORTED_SITES,
  readBrowserSites,
} from '@/main/browser-import/chromium-site-names'

const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false
)

interface FixturePage {
  url: string
  /** Omitted for the rows Chromium stores with no title at all. */
  title?: string
  visitCount?: number
  /** Chromium's own flag for redirect hops nobody chose to open. */
  hidden?: boolean
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-site-names-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeHistoryDatabase(pages: FixturePage[]): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const path = join(directory, 'History')
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url LONGVARCHAR,
      title LONGVARCHAR,
      visit_count INTEGER DEFAULT 0 NOT NULL,
      typed_count INTEGER DEFAULT 0 NOT NULL,
      last_visit_time INTEGER NOT NULL,
      hidden INTEGER DEFAULT 0 NOT NULL
    );
  `)
  const insert = database.prepare(
    'INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?)'
  )
  for (const page of pages) {
    insert.run(page.url, page.title ?? null, page.visitCount ?? 1, page.hidden ? 1 : 0)
  }
  database.close()
  return path
}

function hostnames(sites: { hostname: string }[]): string[] {
  return sites.map((site) => site.hostname)
}

describe.skipIf(!sqliteAvailable)('readBrowserSites', () => {
  it('learns a site’s name from the part of its titles that never changes', async () => {
    const path = await writeHistoryDatabase([
      {
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox (12) - ada@example.com - Gmail',
      },
      { url: 'https://mail.google.com/mail/u/0/#sent', title: 'Sent - ada@example.com - Gmail' },
      {
        url: 'https://mail.google.com/mail/u/0/#drafts',
        title: 'Drafts (2) - ada@example.com - Gmail',
      },
    ])

    const sites = await readBrowserSites(path, new Set(['mail.google.com']))

    // Nothing here hardcodes Gmail — it is the only segment on every page.
    expect(sites[0]?.name).toBe('Gmail')
  })

  it('finds a name that leads the title rather than trailing it', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://github.com/', title: 'GitHub - Where the world builds software' },
      { url: 'https://github.com/pulls', title: 'GitHub - Pull requests' },
    ])

    const sites = await readBrowserSites(path, new Set(['github.com']))

    expect(sites[0]?.name).toBe('GitHub')
  })

  it('handles a title with no separator at all', async () => {
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: 'Example' }])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(sites[0]?.name).toBe('Example')
  })

  it('prefers the shorter candidate when pages are split evenly', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://linear.app/a', title: 'Linear - Issue tracking' },
      { url: 'https://linear.app/b', title: 'Issue tracking - Linear' },
    ])

    const sites = await readBrowserSites(path, new Set(['linear.app']))

    expect(sites[0]?.name).toBe('Linear')
  })

  it('rejects a whole-title tagline as a name while still offering the site', async () => {
    const long = 'A very long marketing sentence that is plainly not what this site is called'
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: long }])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(hostnames(sites)).toEqual(['example.com'])
    expect(sites[0]?.name).toBeUndefined()
  })

  it('offers a host that is visited but has never carried a title', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://untitled.example.com/feed', visitCount: 7 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(sites).toEqual([{ hostname: 'untitled.example.com', name: undefined, visits: 7 }])
  })

  it('ignores pages that are not on the web', async () => {
    const path = await writeHistoryDatabase([
      { url: 'chrome-extension://abc/page.html', title: 'Extension' },
      { url: 'file:///Users/ada/notes.html', title: 'Notes' },
    ])

    const sites = await readBrowserSites(path, new Set(['abc', '']))

    expect(sites).toEqual([])
  })

  it('imports the same list every time for the same profile', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://example.com/a', title: 'Alpha - Example' },
      { url: 'https://example.com/b', title: 'Beta - Sample' },
    ])

    const first = await readBrowserSites(path, new Set(['example.com']))
    const second = await readBrowserSites(path, new Set(['example.com']))

    expect(first).toEqual(second)
  })

  /**
   * The regression this pins: the shared reader enables BigInt reads, so every
   * SQLite integer arrives as `bigint` and a `typeof value === 'number'` guard
   * scored every imported site zero, flattening the omnibox ordering.
   */
  it('carries the source browser’s visit count across as a real number', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://example.com/', title: 'Example', visitCount: 4242 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(sites[0]?.visits).toBe(4242)
    expect(typeof sites[0]?.visits).toBe('number')
  })

  it('ranks a site used across many pages above one reached by refreshing a single page', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://deep.example.com/dashboard', title: 'Deep', visitCount: 100 },
      { url: 'https://broad.example.com/a', title: 'Broad', visitCount: 30 },
      { url: 'https://broad.example.com/b', title: 'Broad', visitCount: 30 },
      { url: 'https://broad.example.com/c', title: 'Broad', visitCount: 30 },
      { url: 'https://broad.example.com/d', title: 'Broad', visitCount: 30 },
      { url: 'https://broad.example.com/e', title: 'Broad', visitCount: 30 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(hostnames(sites)).toEqual(['broad.example.com', 'deep.example.com'])
    expect(sites[0]?.visits).toBe(150)
  })

  it('orders the most-used first and settles ties alphabetically', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://zeta.example.com/', title: 'Zeta', visitCount: 10 },
      { url: 'https://alpha.example.com/', title: 'Alpha', visitCount: 10 },
      { url: 'https://middle.example.com/', title: 'Middle', visitCount: 50 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(hostnames(sites)).toEqual([
      'middle.example.com',
      'alpha.example.com',
      'zeta.example.com',
    ])
  })

  it('leaves out the redirect hops Chromium hides from its own omnibox', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://redirect.example.com/', title: 'Redirect', visitCount: 900, hidden: true },
      { url: 'https://real.example.com/', title: 'Real', visitCount: 3 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(hostnames(sites)).toEqual(['real.example.com'])
  })

  it('admits a subdomain the imported apex domain covers', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://www.google.com/search?q=sim', title: 'sim - Google Search' },
    ])

    // The cookie jar contributes `.google.com` with its leading dot stripped;
    // the page the user actually opened is the subdomain.
    const sites = await readBrowserSites(path, new Set(['google.com']))

    expect(hostnames(sites)).toEqual(['www.google.com'])
  })

  it('imports only hosts the imported domains cover, never the rest of the history', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://mail.google.com/', title: 'Gmail' },
      { url: 'https://somewhere-private.example/', title: 'Private' },
    ])

    const sites = await readBrowserSites(path, new Set(['google.com']))

    expect(hostnames(sites)).toEqual(['mail.google.com'])
  })

  it('drops the profile’s most-visited host when nothing imported covers it', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://uncovered.example.org/', title: 'Uncovered', visitCount: 5000 },
      { url: 'https://docs.example.com/', title: 'Docs', visitCount: 2 },
    ])

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(hostnames(sites)).toEqual(['docs.example.com'])
  })

  it('contributes no more hosts than one import may, keeping the most-used', async () => {
    const overflow = MAX_IMPORTED_SITES + 50
    const pages = Array.from({ length: overflow }, (_, index) => ({
      url: `https://site-${String(index).padStart(3, '0')}.example.com/`,
      title: `Site ${index}`,
      visitCount: overflow - index,
    }))
    const path = await writeHistoryDatabase(pages)

    const sites = await readBrowserSites(path, new Set(['example.com']))

    expect(sites).toHaveLength(MAX_IMPORTED_SITES)
    expect(sites[0]?.hostname).toBe('site-000.example.com')
    expect(sites.at(-1)?.hostname).toBe(
      `site-${String(MAX_IMPORTED_SITES - 1).padStart(3, '0')}.example.com`
    )
  })

  it('survives an unreadable history rather than failing the import', async () => {
    const sites = await readBrowserSites(join(directory, 'absent'), new Set(['example.com']))

    expect(sites).toEqual([])
  })

  it('asks for nothing when no domain was imported to cover it', async () => {
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: 'Example' }])

    expect(await readBrowserSites(path, new Set())).toEqual([])
  })
})

describe('isCoveredByDomain', () => {
  it('covers a host that is itself an imported domain', () => {
    expect(isCoveredByDomain('example.com', new Set(['example.com']))).toBe(true)
  })

  it('covers a subdomain of an imported domain, however deep', () => {
    const domains = new Set(['example.com'])

    expect(isCoveredByDomain('mail.example.com', domains)).toBe(true)
    expect(isCoveredByDomain('a.b.c.example.com', domains)).toBe(true)
  })

  it('does not cover an apex whose subdomain is all that was imported', () => {
    expect(isCoveredByDomain('example.com', new Set(['mail.example.com']))).toBe(false)
  })

  it('matches on label boundaries, not bare string suffixes', () => {
    expect(isCoveredByDomain('notexample.com', new Set(['example.com']))).toBe(false)
  })

  it('covers nothing when no domain was imported', () => {
    expect(isCoveredByDomain('example.com', new Set())).toBe(false)
  })

  /**
   * The documented boundary: coverage is a pure label walk with no public
   * suffix list, so a cookie on a registry suffix such as `github.io` admits
   * every user site under it. Should a PSL guard ever be added, this test is
   * meant to fail loudly rather than let the change land unnoticed.
   */
  it('lets a public-suffix domain cover the sites beneath it', () => {
    expect(isCoveredByDomain('alice.github.io', new Set(['github.io']))).toBe(true)
  })
})
