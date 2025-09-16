export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.sim.ai'

  const robotsTxt = `# Robots.txt for Sim Documentation
# Generated on ${new Date().toISOString()}

User-agent: *
Allow: /

# Allow all well-behaved crawlers
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# AI and LLM crawlers
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

# Disallow admin and internal paths (if any exist)
Disallow: /.next/
Disallow: /api/internal/
Disallow: /_next/static/
Disallow: /admin/

# Allow but don't prioritize these
Allow: /api/search
Allow: /llms.txt
Allow: /llms.mdx/

# Sitemaps
Sitemap: ${baseUrl}/sitemap.xml

# Additional resources for AI indexing
# See https://github.com/AnswerDotAI/llms-txt for more info
# LLM-friendly content available at: ${baseUrl}/llms.txt`

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}
