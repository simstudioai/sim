import {
  INTEGRATION_ACTION_COUNT_LABEL,
  INTEGRATION_COUNT_LABEL,
  INTEGRATION_TRIGGER_COUNT_LABEL,
} from '@sim/deployment-config/integration-claims'
import { getAllPostMeta as getAllBlogPostMeta } from '@/lib/blog/registry'
import { toSiteUrl } from '@/lib/core/utils/urls'
import { getAllCustomerStoryMeta } from '@/lib/customers/registry'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { getAllPostMeta as getAllLibraryPostMeta } from '@/lib/library/registry'
import { ALL_COMPETITORS } from '@/app/(landing)/comparisons/utils'
import { PLATFORM_MENU } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import { MODEL_COMPARISONS } from '@/app/(landing)/models/comparisons'
import { MODEL_TOOLS } from '@/app/(landing)/models/tools'
import { MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'
import {
  DOCS_LINE,
  GITHUB_LINE,
  LLMS_HEADER,
  linkLine,
  markdownResponse,
  navMenuLines,
  PRICING_LINE,
  SITEMAP_LINE,
  SOLUTION_LINES,
  section,
} from '@/app/llms.txt/llms'

export const dynamic = 'force-static'
export const revalidate = 86400

/**
 * `/llms.txt` per https://llmstxt.org: a curated, link-first index of the
 * public site. Content sections are generated from the same registries the
 * sitemap reads, so new and retired pages track automatically. Individual
 * integration and model pages are left to their hubs and the sitemap.
 */
export async function GET() {
  const [blogPosts, libraryPosts, customerStories] = await Promise.all([
    getAllBlogPostMeta(),
    getAllLibraryPostMeta(),
    getAllCustomerStoryMeta(),
  ])

  return markdownResponse(
    [
      LLMS_HEADER,
      'Teams build agents in the visual workflow builder, by talking to Sim in Chat, or with code through the API and SDKs. The workspace includes knowledge bases, tables, files, and logs for every run. Sim is open source (Apache 2.0) and runs in the cloud or self-hosted.',
      `The full text of the library, customer stories, and comparison facts is in [llms-full.txt](${toSiteUrl('/llms-full.txt')}).`,
      section('Platform', [
        linkLine('Home', '/', 'Product overview and primary entry point'),
        ...navMenuLines(PLATFORM_MENU),
        PRICING_LINE,
      ]),
      section('Solutions', SOLUTION_LINES),
      section(
        'Customers',
        customerStories.length > 0
          ? [
              linkLine(
                'Customer stories',
                '/customers',
                'How teams build and run AI agents with Sim'
              ),
              ...customerStories.map((story) =>
                linkLine(story.title, story.canonical, story.description)
              ),
            ]
          : []
      ),
      section('Comparisons', [
        linkLine(
          'All comparisons',
          '/comparisons',
          'Sourced, dated comparisons of Sim with AI agent and workflow automation platforms'
        ),
        ...ALL_COMPETITORS.map((c) =>
          linkLine(`Sim vs ${c.name}`, `/comparisons/${c.id}`, c.oneLiner)
        ),
      ]),
      section('Library', [
        'Each article is also served as Markdown at its URL with `.md` appended.',
        '',
        linkLine('Library', '/library', 'Comparisons, how-tos, and roundups on building AI agents'),
        ...libraryPosts.map((p) => linkLine(p.title, p.canonical, p.description)),
      ]),
      section('Integrations and models', [
        linkLine(
          'Integrations',
          '/integrations',
          `${INTEGRATION_COUNT_LABEL} integrations with ${INTEGRATION_ACTION_COUNT_LABEL} actions and ${INTEGRATION_TRIGGER_COUNT_LABEL} triggers agents can use`
        ),
        linkLine(
          'Models',
          '/models',
          'Every supported model with pricing, context window, and capabilities'
        ),
        ...Object.values(MODEL_TOOLS).map((tool) =>
          linkLine(tool.name, tool.href, tool.description)
        ),
        linkLine(
          'LLM context window comparison',
          '/models/context-windows',
          'Context windows, max output tokens, and API prices for every tracked model'
        ),
        ...MODEL_PROVIDERS_WITH_CATALOGS.map((provider) =>
          linkLine(`${provider.name} models`, provider.href, provider.description)
        ),
      ]),
      section(
        'Model comparisons',
        MODEL_COMPARISONS.map((comparison) =>
          linkLine(
            comparison.title,
            comparison.href,
            'API pricing, context window, max output, and capabilities side by side'
          )
        )
      ),
      section('Docs', [
        linkLine('Docs index', `${DOCS_URL}/llms.txt`, 'llms.txt index of the Sim documentation'),
        linkLine(
          'Docs full text',
          `${DOCS_URL}/llms-full.txt`,
          'Full text of the Sim documentation'
        ),
        DOCS_LINE,
      ]),
      section('Blog', [
        linkLine('Blog', '/blog', 'Announcements, engineering deep dives, and product context'),
        ...blogPosts.map((p) => linkLine(p.title, p.canonical, p.description)),
      ]),
      section('Optional', [
        linkLine('Changelog', '/changelog', 'Product updates and release notes'),
        GITHUB_LINE,
        linkLine('Community Slack', SLACK_COMMUNITY_URL, 'Community workspace'),
        linkLine('Terms of Service', '/terms'),
        linkLine('Privacy Policy', '/privacy'),
        linkLine('Cookie Policy', '/cookie-policy'),
        SITEMAP_LINE,
      ]),
    ],
    revalidate
  )
}
