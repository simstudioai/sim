import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBrowserSiteNames } from '@/main/browser-import/chromium-site-names'

const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false
)

interface FixturePage {
  url: string
  title: string
  visitCount?: number
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
    'INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, 0)'
  )
  for (const page of pages) insert.run(page.url, page.title, page.visitCount ?? 1)
  database.close()
  return path
}

describe.skipIf(!sqliteAvailable)('readBrowserSiteNames', () => {
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

    const names = await readBrowserSiteNames(path, new Set(['mail.google.com']))

    // Nothing here hardcodes Gmail — it is the only segment on every page.
    expect(names.get('mail.google.com')).toBe('Gmail')
  })

  it('finds a name that leads the title rather than trailing it', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://github.com/', title: 'GitHub - Where the world builds software' },
      { url: 'https://github.com/pulls', title: 'GitHub - Pull requests' },
    ])

    const names = await readBrowserSiteNames(path, new Set(['github.com']))

    expect(names.get('github.com')).toBe('GitHub')
  })

  it('handles a title with no separator at all', async () => {
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: 'Example' }])

    const names = await readBrowserSiteNames(path, new Set(['example.com']))

    expect(names.get('example.com')).toBe('Example')
  })

  it('prefers the shorter candidate when pages are split evenly', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://linear.app/a', title: 'Linear - Issue tracking' },
      { url: 'https://linear.app/b', title: 'Issue tracking - Linear' },
    ])

    const names = await readBrowserSiteNames(path, new Set(['linear.app']))

    expect(names.get('linear.app')).toBe('Linear')
  })

  it('names only the hosts being imported, never the rest of the history', async () => {
    const path = await writeHistoryDatabase([
      { url: 'https://mail.google.com/', title: 'Gmail' },
      { url: 'https://somewhere-private.example/', title: 'Private' },
    ])

    const names = await readBrowserSiteNames(path, new Set(['mail.google.com']))

    expect([...names.keys()]).toEqual(['mail.google.com'])
  })

  it('asks for nothing when there are no hosts to name', async () => {
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: 'Example' }])

    expect(await readBrowserSiteNames(path, new Set())).toEqual(new Map())
  })

  it('ignores pages that are not on the web', async () => {
    const path = await writeHistoryDatabase([
      { url: 'chrome-extension://abc/page.html', title: 'Extension' },
      { url: 'file:///Users/ada/notes.html', title: 'Notes' },
    ])

    const names = await readBrowserSiteNames(path, new Set(['abc', '']))

    expect(names.size).toBe(0)
  })

  it('rejects a whole-title tagline as a name', async () => {
    const long = 'A very long marketing sentence that is plainly not what this site is called'
    const path = await writeHistoryDatabase([{ url: 'https://example.com/', title: long }])

    const names = await readBrowserSiteNames(path, new Set(['example.com']))

    expect(names.has('example.com')).toBe(false)
  })

  it('survives an unreadable history rather than failing the import', async () => {
    const names = await readBrowserSiteNames(join(directory, 'absent'), new Set(['example.com']))

    expect(names).toEqual(new Map())
  })

  it('imports the same name every time for the same profile', async () => {
    const pages = [
      { url: 'https://example.com/a', title: 'Alpha - Example' },
      { url: 'https://example.com/b', title: 'Beta - Sample' },
    ]
    const path = await writeHistoryDatabase(pages)

    const first = await readBrowserSiteNames(path, new Set(['example.com']))
    const second = await readBrowserSiteNames(path, new Set(['example.com']))

    expect(first.get('example.com')).toBe(second.get('example.com'))
  })
})
