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

# Search engine crawlers
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Slurp
Allow: /

User-agent: DuckDuckBot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: YandexBot
Allow: /

# AI and LLM crawlers - explicitly allowed for documentation indexing
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: CCBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Applebot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Diffbot
Allow: /

User-agent: FacebookBot
Allow: /

User-agent: cohere-ai
Allow: /

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
