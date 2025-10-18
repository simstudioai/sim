export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.sim.ai'

  const robotsTxt = `# Robots.txt for Sim Documentation
# Generated on ${new Date().toISOString()}

User-agent: *
Allow: /

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

# Disallow admin and internal paths (if any exist)
Disallow: /.next/
Disallow: /api/internal/
Disallow: /_next/static/
Disallow: /admin/

# Allow but don't prioritize these
Allow: /api/search
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /llms.mdx/

# Sitemaps
Sitemap: ${baseUrl}/sitemap.xml

# Crawl delay for aggressive bots (optional)
# Crawl-delay: 1

# Additional resources for AI indexing
# See https://github.com/AnswerDotAI/llms-txt for more info
# LLM-friendly content:
#   Manifest: ${baseUrl}/llms.txt
#   Full content: ${baseUrl}/llms-full.txt
#   Individual pages: ${baseUrl}/llms.mdx/[page-path]

# Multi-language documentation available at:
# ${baseUrl}/en - English
# ${baseUrl}/es - Español
# ${baseUrl}/fr - Français
# ${baseUrl}/de - Deutsch
# ${baseUrl}/ja - 日本語
# ${baseUrl}/zh - 简体中文`

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}
