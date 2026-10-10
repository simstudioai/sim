import { describe, expect, it } from 'vitest'
import { readLucidMcp } from '@/lib/sim-search/live/lucid-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const ID = '0b6a3f0e-5a52-4c55-9d8c-6d2f2a1b9c11'
const COUNTS = [3, 0, 2, 1]
const TITLE = 'Fixture diagram'
const metadataRow = {
  documentId: ID,
  viewUrl: `https://lucid.app/lucidchart/${ID}/view`,
  product: 'lucidchart',
  title: TITLE,
  version: 7,
  pageCount: COUNTS.length,
  lastModified: '2026-10-01T12:00:00Z',
}

function manifest(extra: Record<string, unknown> = {}) {
  return {
    document_id: ID,
    edit_url: `https://lucid.app/lucidchart/${ID}/edit`,
    title: TITLE,
    metadata: { page_count: COUNTS.length, page_region_counts: COUNTS, ...extra },
  }
}

function regionResponse(pageIndex: number, region: number) {
  const pageId = `page-${pageIndex}`
  return {
    ...manifest({ page_index: pageIndex + 1 }),
    page_index: pageIndex + 1,
    page_id: pageId,
    text: JSON.stringify({
      pages: [
        {
          pageIndex,
          pageId,
          pageTitle: `Page ${pageIndex + 1}`,
          totalChunks: COUNTS[pageIndex],
          requestedChunks: COUNTS[pageIndex]
            ? [{ chunkIndex: region, data: { label: `p${pageIndex}r${region}` } }]
            : [],
        },
      ],
    }),
  }
}

/** Region fetches settle in reverse request order, after a number of ticks, to expose ordering. */
function lucidClient(options: { corruptFirstRegion?: boolean } = {}) {
  let inFlight = 0
  let maxInFlight = 0
  let regionCalls = 0
  const client: ManagedSearchMcpClient = {
    async call(name, args) {
      if (name === 'lucid_get_document_metadata') return metadataRow
      if (args.metadata_only) return manifest()
      const pageIndex = Number(args.page_index) - 1
      const region = Array.isArray(args.region_index) ? Number(args.region_index[0]) - 1 : 0
      const call = regionCalls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      for (let tick = 0; tick < 10 - call; tick++) await Promise.resolve()
      inFlight--
      const response = regionResponse(pageIndex, region)
      return options.corruptFirstRegion && call === 0 ? { ...response, page_id: 'other' } : response
    },
  }
  return { client, maxInFlight: () => maxInFlight, regionCalls: () => regionCalls }
}

const REFERENCE = { id: ID, kind: 'lucidchart', revision: '7' }

describe('readLucidMcp', () => {
  it('fetches at most four regions at once and assembles them in page and region order', async () => {
    const { client, maxInFlight, regionCalls } = lucidClient()
    const document = await readLucidMcp(client, REFERENCE)
    expect(regionCalls()).toBe(7)
    expect(maxInFlight()).toBe(4)
    const pages = JSON.parse(document.content ?? '').pages as {
      pageId: string
      requestedChunks: { data: { label: string } }[]
    }[]
    expect(pages.map((page) => page.pageId)).toEqual(['page-0', 'page-1', 'page-2', 'page-3'])
    expect(pages.map((page) => page.requestedChunks.map((chunk) => chunk.data.label))).toEqual([
      ['p0r0', 'p0r1', 'p0r2'],
      [],
      ['p2r0', 'p2r1'],
      ['p3r0'],
    ])
  })

  it('stops scheduling region fetches once a region fails validation', async () => {
    const { client, regionCalls } = lucidClient({ corruptFirstRegion: true })
    await expect(readLucidMcp(client, REFERENCE)).rejects.toThrow(/mismatched page regions/)
    expect(regionCalls()).toBe(4)
  })
})
