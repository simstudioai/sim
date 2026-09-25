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

  it('imports only hosts the imported domains cover, never the rest of the history', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://mail.google.com/', title: 'Gmail' },
      { url: 'https://somewhere-private.example/', title: 'Private' },
    ])

    const sites = await readBrowserSites(path, new Set(['google.com']))

    expect(hostnames(sites)).toEqual(['mail.google.com'])
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
})

describe('isCoveredByDomain', () => {
  it('does not cover an apex whose subdomain is all that was imported', () => {
    expect(isCoveredByDomain('example.com', new Set(['mail.example.com']))).toBe(false)
  })

  it('matches on label boundaries, not bare string suffixes', () => {
    expect(isCoveredByDomain('notexample.com', new Set(['example.com']))).toBe(false)
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
