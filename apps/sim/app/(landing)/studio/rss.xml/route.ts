import { NextResponse } from 'next/server'
import { getAllPostMeta } from '@/lib/blog/registry'

export const revalidate = 3600

export async function GET() {
  const posts = await getAllPostMeta()
  const items = posts.slice(0, 50)
  const site = 'https://sim.ai'

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Sim Studio</title>
    <link>${site}</link>
    <description>Announcements, insights, and guides for AI agent workflows.</description>
    ${items
      .map(
        (p) => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${p.canonical}</link>
      <guid>${p.canonical}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description><![CDATA[${p.description}]]></description>
      ${(p.authors || [p.author])
        .map((a) => `<author><![CDATA[${a.name}${a.url ? ` (${a.url})` : ''}]]></author>`)
        .join('\n')}
    </item>`
      )
      .join('')}
  </channel>
</rss>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
