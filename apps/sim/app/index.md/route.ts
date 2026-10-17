import { SITE_URL } from '@/lib/core/utils/urls'
import { DOCS_URL } from '@/lib/help-links'
import {
  HOME_FEATURES,
  HOME_HERO_HEADING,
  HOME_HERO_SUMMARY,
  HOME_PAGE_DESCRIPTION,
} from '@/app/(landing)/components/home-structured-data'
import { PLATFORM_MENU } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import {
  DOCS_LINE,
  GITHUB_LINE,
  linkLine,
  markdownResponse,
  navMenuLines,
  PRICING_LINE,
  SITEMAP_LINE,
  SOLUTION_LINES,
  section,
} from '@/app/llms.txt/llms'

export const dynamic = 'force-static'
export const revalidate = 3600

/**
 * The homepage as Markdown. `next.config.ts` rewrites `/` here when `Accept` asks for
 * `text/markdown`, so this body is also served at `/`. It is `no-store` so a cache that ignores
 * `Vary` can never hand it to a browser; at worst such a cache serves the HTML to a Markdown
 * client.
 */
export async function GET() {
  const response = markdownResponse(
    [
      `# Sim: ${HOME_HERO_HEADING.join(' ')}`,
      `> ${HOME_PAGE_DESCRIPTION}`,
      HOME_HERO_SUMMARY,
      section('Get started', [
        linkLine('Sign up', '/signup', 'Create a free account'),
        PRICING_LINE,
        DOCS_LINE,
        GITHUB_LINE,
      ]),
      section('Build with code', [
        linkLine(
          'API quickstart',
          `${DOCS_URL}/api-reference/getting-started`,
          'Create an API key and run a deployed workflow'
        ),
        linkLine(
          'TypeScript SDK',
          `${DOCS_URL}/api-reference/typescript`,
          '`bun add simstudio-ts-sdk`'
        ),
        linkLine('Python SDK', `${DOCS_URL}/api-reference/python`, '`pip install simstudio-sdk`'),
        linkLine('CLI', `${DOCS_URL}/cli`, '`bun add -g sim`'),
        linkLine('MCP server', `${DOCS_URL}/mcp/overview`, 'Connect an AI app to Sim'),
      ]),
      section(
        'What teams do in Sim',
        HOME_FEATURES.map((feature) => `- ${feature}`)
      ),
      section('Platform', navMenuLines(PLATFORM_MENU)),
      section('Solutions', SOLUTION_LINES),
      section('More', [
        linkLine('llms.txt', '/llms.txt', 'An index of every public page'),
        linkLine(
          'llms-full.txt',
          '/llms-full.txt',
          'Full text of the library, customer stories, and comparisons'
        ),
        SITEMAP_LINE,
      ]),
    ],
    revalidate
  )
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Link', `<${SITE_URL}>; rel="canonical"`)
  return response
}
