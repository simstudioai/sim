import { NextResponse } from 'next/server'
import { getAllEntryMeta } from '@/lib/changelog'
import { SITE_URL } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/** Request-scoped logging needs dynamic handling; successful feeds are cached by the CDN. */
export const dynamic = 'force-dynamic'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** RSS is a public XML protocol; its summaries share the website's published content source. */
export const GET = withRouteHandler(
  async () => {
    const entries = (await getAllEntryMeta()).slice(0, 50)
    const items = entries
      .map(
        (entry) => `
    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.canonical)}</link>
      <guid isPermaLink="true">${escapeXml(entry.release?.url ?? entry.canonical)}</guid>
      <pubDate>${new Date(entry.date).toUTCString()}</pubDate>
      <description>${escapeXml(entry.description)}</description>
    </item>`
      )
      .join('')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Sim Changelog</title>
  <link>${SITE_URL}/changelog</link>
  <description>New features, improvements, and fixes in Sim.</description>
  <language>en-us</language>${items}
</channel></rss>`
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
      },
    })
  },
  {
    unhandledErrorResponse: () =>
      new NextResponse('Service Unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
      }),
  }
)
