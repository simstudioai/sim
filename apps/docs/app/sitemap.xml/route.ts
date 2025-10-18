import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.sim.ai'

  const allPages = source.getPages()

  const getPriority = (url: string): string => {
    if (url === '/introduction' || url === '/') return '1.0'
    if (url === '/getting-started') return '0.9'
    if (url.match(/^\/[^/]+$/)) return '0.8'
    if (url.includes('/sdks/') || url.includes('/tools/')) return '0.7'
    return '0.6'
  }

  const urls = allPages
    .flatMap((page) => {
      const urlWithoutLang = page.url.replace(/^\/[a-z]{2}\//, '/')

      return i18n.languages.map((lang) => {
        const url =
          lang === i18n.defaultLanguage
            ? `${baseUrl}${urlWithoutLang}`
            : `${baseUrl}/${lang}${urlWithoutLang}`

        return `  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${getPriority(urlWithoutLang)}</priority>
    ${i18n.languages.length > 1 ? generateAlternateLinks(baseUrl, urlWithoutLang) : ''}
  </url>`
      })
    })
    .join('\n')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}

function generateAlternateLinks(baseUrl: string, urlWithoutLang: string): string {
  return i18n.languages
    .map((lang) => {
      const url =
        lang === i18n.defaultLanguage
          ? `${baseUrl}${urlWithoutLang}`
          : `${baseUrl}/${lang}${urlWithoutLang}`
      return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${url}" />`
    })
    .join('\n')
}
