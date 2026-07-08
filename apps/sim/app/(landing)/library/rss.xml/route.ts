import { NextResponse } from 'next/server'
import { SITE_URL } from '@/lib/core/utils/urls'
import { getAllPostMeta } from '@/lib/library/registry'
import { LIBRARY_SECTION } from '@/lib/library/seo'

export const revalidate = 3600

export async function GET() {
  const posts = await getAllPostMeta()
  const items = posts.slice(0, 50)
  const site = SITE_URL
  const lastBuildDate =
    items.length > 0
      ? new Date(items[0].updated ?? items[0].date).toUTCString()
      : new Date().toUTCString()

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Sim ${LIBRARY_SECTION.name}</title>
    <link>${site}</link>
    <description>${LIBRARY_SECTION.description}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${site}${LIBRARY_SECTION.basePath}/rss.xml" rel="self" type="application/rss+xml" />
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
      ${p.tags.map((t) => `<category><![CDATA[${t}]]></category>`).join('\n      ')}
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
