import { NextResponse } from 'next/server'
import { getAllPostMeta } from '@/lib/blog/registry'

export const revalidate = 3600

export async function GET() {
  const posts = await getAllPostMeta()
  const base = 'https://sim.ai'
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${posts
  .map(
    (p) => `<url>
  <loc>${p.canonical}</loc>
  <image:image>
    <image:loc>${p.ogImage.startsWith('http') ? p.ogImage : `${base}${p.ogImage}`}</image:loc>
    <image:title><![CDATA[${p.title}]]></image:title>
    <image:caption><![CDATA[${p.description}]]></image:caption>
  </image:image>
</url>`
  )
  .join('\n')}
</urlset>`
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
