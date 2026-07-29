import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBrowserFavicons } from '@/main/browser-import/chromium-favicons'

const sqliteAvailable = await import('node:sqlite').then(
  () => true,
  () => false
)

/** A minimal but genuinely valid 1x1 PNG. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082',
  'hex'
)

interface FixtureIcon {
  pageUrl: string
  width?: number
  data?: Uint8Array
}

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sim-favicons-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeFaviconDatabase(icons: FixtureIcon[]): Promise<string> {
  const { DatabaseSync } = await import('node:sqlite')
  const path = join(directory, 'Favicons')
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url TEXT, icon_id INTEGER);
    CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, image_data BLOB, width INTEGER);
  `)
  const mapping = database.prepare('INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)')
  const bitmap = database.prepare(
    'INSERT INTO favicon_bitmaps (icon_id, image_data, width) VALUES (?, ?, ?)'
  )
  icons.forEach((icon, index) => {
    mapping.run(icon.pageUrl, index + 1)
    bitmap.run(index + 1, icon.data ?? PNG, icon.width ?? 32)
  })
  database.close()
  return path
}

describe.skipIf(!sqliteAvailable)('readBrowserFavicons', () => {
  it('returns an icon keyed by origin as a data URL', async () => {
    const path = await writeFaviconDatabase([{ pageUrl: 'https://example.com/login' }])

    const icons = await readBrowserFavicons(path, new Set(['https://example.com']))

    expect(icons.get('https://example.com')).toMatch(/^data:image\/png;base64,/)
  })

  it('reads only the origins being imported', async () => {
    // A password import must not drag the browser's whole history along.
    const path = await writeFaviconDatabase([
      { pageUrl: 'https://wanted.test/' },
      { pageUrl: 'https://unrelated.test/' },
    ])

    const icons = await readBrowserFavicons(path, new Set(['https://wanted.test']))

    expect([...icons.keys()]).toEqual(['https://wanted.test'])
  })

  it('does nothing when no origins are requested', async () => {
    const path = await writeFaviconDatabase([{ pageUrl: 'https://example.com/' }])

    await expect(readBrowserFavicons(path, new Set())).resolves.toEqual(new Map())
  })

  it('prefers the bitmap closest to the size actually displayed', async () => {
    const large = Buffer.concat([PNG, Buffer.alloc(16)])
    const path = await writeFaviconDatabase([
      { pageUrl: 'https://example.com/', width: 16 },
      { pageUrl: 'https://example.com/other', width: 32, data: large },
    ])

    const icon = await readBrowserFavicons(path, new Set(['https://example.com']))

    expect(icon.get('https://example.com')).toBe(
      `data:image/png;base64,${large.toString('base64')}`
    )
  })

  it('ignores rows that are not usable icons', async () => {
    const path = await writeFaviconDatabase([
      { pageUrl: 'https://notpng.test/', data: Buffer.from('<svg/>') },
      { pageUrl: 'https://huge.test/', data: Buffer.concat([PNG, Buffer.alloc(17 * 1024)]) },
      { pageUrl: 'https://oversized.test/', width: 512 },
    ])

    const icons = await readBrowserFavicons(
      path,
      new Set(['https://notpng.test', 'https://huge.test', 'https://oversized.test'])
    )

    expect(icons.size).toBe(0)
  })

  it('treats an unreadable favicon store as simply having no icons', async () => {
    // Icons are decoration; failing to read them must not fail an import.
    await expect(
      readBrowserFavicons(join(directory, 'absent'), new Set(['https://example.com']))
    ).resolves.toEqual(new Map())
  })
})
