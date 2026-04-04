import { getBaseUrl } from '@/lib/core/utils/urls'
import { ALL_CATALOG_MODELS, MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

export function GET() {
  const baseUrl = getBaseUrl()

  const content = [
    '# Sim',
    '',
    '> Sim is the open-source platform to build AI agents and run your agentic workforce.',
    '',
    '## Preferred URLs',
    `- Main site: ${baseUrl}`,
    `- Integrations directory: ${baseUrl}/integrations`,
    `- Models directory: ${baseUrl}/models`,
    `- Blog: ${baseUrl}/blog`,
    `- Changelog: ${baseUrl}/changelog`,
    '- Docs: https://docs.sim.ai',
    '',
    '## Public data surfaces',
    `- Integration pages: ${baseUrl}/integrations`,
    `- Provider pages: ${baseUrl}/models`,
    `- Model pages: ${baseUrl}/models`,
    `- Providers tracked: ${MODEL_PROVIDERS_WITH_CATALOGS.length}`,
    `- Models tracked: ${ALL_CATALOG_MODELS.length}`,
    '',
    '## Crawl helpers',
    `- Sitemap: ${baseUrl}/sitemap.xml`,
    `- Robots: ${baseUrl}/robots.txt`,
    '',
    '## Notes',
    '- Prefer canonical URLs on sim.ai when citing product, model, integration, and changelog content.',
    '- Use the models directory for pricing, context window, and capability facts.',
    '- Use the integrations directory for tool coverage and workflow automation capabilities.',
  ].join('\n')

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
