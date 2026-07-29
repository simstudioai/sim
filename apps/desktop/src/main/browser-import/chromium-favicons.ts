import { normalizeOrigin } from '@/main/browser-credentials/origin'
import { queryBrowserDatabase } from '@/main/browser-import/sqlite-source'
import { toNumber, toText } from '@/main/browser-import/types'

/**
 * Reads site icons out of a Chromium profile's `Favicons` database.
 *
 * Deliberately local. The obvious way to get a favicon is to ask a public
 * service for it, which would hand that service the domain of every site the
 * user has a password for — the exact list this feature exists to protect.
 * The browser being imported from already has these icons on disk, so they
 * come from there and never touch the network.
 */

/** Chromium stores several sizes per icon; this is the one worth keeping. */
const PREFERRED_SIZE = 32
const MAX_SIZE = 128
/** A favicon larger than this is not worth carrying inside the vault. */
const MAX_BYTES = 16 * 1024
const MAX_ROWS = 20_000

const FAVICON_QUERY = `
  SELECT icon_mapping.page_url AS page_url,
         favicon_bitmaps.image_data AS image_data,
         favicon_bitmaps.width AS width
  FROM icon_mapping
  JOIN favicon_bitmaps ON favicon_bitmaps.icon_id = icon_mapping.icon_id
  WHERE favicon_bitmaps.image_data IS NOT NULL
  LIMIT ${MAX_ROWS}
`

/** PNG magic number — the only format written back out as a data URL. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(data: Uint8Array): boolean {
  return data.length > PNG_SIGNATURE.length && PNG_SIGNATURE.equals(data.subarray(0, 8))
}

/** How far a bitmap's width is from the size worth keeping. */
function sizeDistance(width: number): number {
  return Math.abs((width || PREFERRED_SIZE) - PREFERRED_SIZE)
}

/**
 * Site icons for `origins`, keyed by origin, as `data:` URLs.
 *
 * Only the requested origins are returned, so a profile's entire browsing
 * history does not come along with a password import. Never throws: an
 * unreadable or unfamiliar favicon store just means no icons.
 */
export async function readBrowserFavicons(
  faviconsPath: string,
  origins: ReadonlySet<string>
): Promise<Map<string, string>> {
  if (origins.size === 0) return new Map()

  let rows: Record<string, unknown>[]
  try {
    rows = await queryBrowserDatabase(faviconsPath, 'Favicons', FAVICON_QUERY)
  } catch {
    // Icons are decoration. Failing to read them must not fail the import.
    return new Map()
  }

  const best = new Map<string, { distance: number; data: Uint8Array }>()
  for (const row of rows) {
    const origin = normalizeOrigin(toText(row.page_url))
    if (origin === null || !origins.has(origin)) continue

    const data = row.image_data
    if (!(data instanceof Uint8Array) || data.length > MAX_BYTES || !isPng(data)) continue

    const width = toNumber(row.width)
    if (width > MAX_SIZE) continue

    const distance = sizeDistance(width)
    const current = best.get(origin)
    if (!current || distance < current.distance) best.set(origin, { distance, data })
  }

  return new Map(
    [...best].map(([origin, { data }]) => [
      origin,
      `data:image/png;base64,${Buffer.from(data).toString('base64')}`,
    ])
  )
}
