import { NextResponse } from 'next/server'

export const dynamic = 'force-static'
export const revalidate = 3600

interface Release {
  id: number
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
  prerelease: boolean
}

function escapeXml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  try {
    const res = await fetch('https://api.github.com/repos/simstudioai/sim/releases', {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate },
    })
    const releases: Release[] = await res.json()
    const items = (releases || [])
      .filter((r) => !r.prerelease)
      .map(
        (r) => `
        <item>
          <title>${escapeXml(r.name || r.tag_name)}</title>
          <link>${r.html_url}</link>
          <guid isPermaLink="true">${r.html_url}</guid>
          <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
          <description><![CDATA[${r.body || ''}]]></description>
        </item>
      `
      )
      .join('')

    const xml = `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
        <channel>
          <title>Sim Changelog</title>
          <link>https://sim.dev/changelog</link>
          <description>Latest changes, fixes and updates in Sim.</description>
          <language>en-us</language>
          ${items}
        </channel>
      </rss>`

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': `public, s-maxage=${revalidate}, stale-while-revalidate=${revalidate}`,
      },
    })
  } catch {
    return new NextResponse('Service Unavailable', { status: 503 })
  }
}
