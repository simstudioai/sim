import { DOCS_BASE_URL } from '@/lib/urls'

export const revalidate = false

export async function GET() {
  const baseUrl = DOCS_BASE_URL

  const robotsTxt = `# Robots.txt for Sim Documentation

User-agent: *
Disallow: /.next/
Disallow: /api/internal/
Disallow: /_next/static/
Disallow: /admin/
Allow: /
Allow: /api/search
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /llms.mdx/

# Sitemaps
Sitemap: ${baseUrl}/sitemap.xml

# Additional resources for AI indexing
# See https://github.com/AnswerDotAI/llms-txt for more info
# LLM-friendly content:
#   Manifest: ${baseUrl}/llms.txt
#   Full content: ${baseUrl}/llms-full.txt
#   Individual pages: ${baseUrl}/llms.mdx/[page-path]`

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}
