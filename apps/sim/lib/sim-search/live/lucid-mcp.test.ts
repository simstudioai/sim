import { describe, expect, it } from 'vitest'
import { readLucidMcp } from '@/lib/sim-search/live/lucid-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const ID = '0b6a3f0e-5a52-4c55-9d8c-6d2f2a1b9c11'
const COUNTS = [2, 1]
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
          requestedChunks: [{ chunkIndex: region, data: { label: `p${pageIndex}r${region}` } }],
        },
      ],
    }),
  }
}

/** Region fetches settle in reverse request order, after a number of ticks, to expose ordering. */
function lucidClient() {
  let inFlight = 0
  let maxInFlight = 0
  let regionCalls = 0
  const client: ManagedSearchMcpClient = {
    async call(name, args) {
      if (name === 'lucid_get_document_metadata') return metadataRow
      if (args.metadata_only) return manifest()
      const pageIndex = Number(args.page_index) - 1
      const region = Array.isArray(args.region_index) ? Number(args.region_index[0]) - 1 : 0
      const delay = 10 - regionCalls++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      for (let tick = 0; tick < delay; tick++) await Promise.resolve()
      inFlight--
      return regionResponse(pageIndex, region)
    },
  }
  return { client, maxInFlight: () => maxInFlight }
}

describe('readLucidMcp', () => {
  it('fetches page regions concurrently and assembles them in page and region order', async () => {
    const { client, maxInFlight } = lucidClient()
    const document = await readLucidMcp(client, { id: ID, kind: 'lucidchart', revision: '7' })
    expect(maxInFlight()).toBeGreaterThan(1)
    const pages = JSON.parse(document.content ?? '').pages as {
      pageId: string
      requestedChunks: { data: { label: string } }[]
    }[]
    expect(pages.map((page) => page.pageId)).toEqual(['page-0', 'page-1'])
    expect(pages.map((page) => page.requestedChunks.map((chunk) => chunk.data.label))).toEqual([
      ['p0r0', 'p0r1'],
      ['p1r0'],
    ])
  })
})
