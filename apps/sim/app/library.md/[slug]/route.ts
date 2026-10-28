import type { NextRequest } from 'next/server'
import type { ContentMeta } from '@/lib/content/schema'
import { toSiteUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getAllPostMeta, getPostSource } from '@/lib/library/registry'
import { LIBRARY_SECTION } from '@/lib/library/seo'
import { markdownResponse, section, toLlmsMarkdown } from '@/app/llms.txt/llms'

type RouteContext = { params: Promise<{ slug: string }> }

const NOT_FOUND_MARKDOWN = `# Article not found

There is no library article at this address. Browse the [library](${toSiteUrl(LIBRARY_SECTION.basePath)}) or the [llms.txt](${toSiteUrl('/llms.txt')}) index.
`

function postMarkdownBlocks(post: ContentMeta, source: string): string[] {
  const authors = (post.authors.length > 0 ? post.authors : [post.author]).map((a) => a.name)
  const published = post.date.slice(0, 10)
  const updated = (post.updated ?? post.date).slice(0, 10)
  return [
    `# ${post.title}`,
    `> ${post.description}`,
    [
      `URL: ${post.canonical}`,
      `By ${authors.join(', ')} · Published ${published}${updated !== published ? ` · Updated ${updated}` : ''}`,
    ].join('\n'),
    toLlmsMarkdown(source, 0),
    section(
      'FAQ',
      (post.faq ?? []).map((item) => `### ${item.q}\n\n${item.a}`),
      '\n\n'
    ),
  ]
}

/**
 * A library article as Markdown, at `/library/<slug>.md` (and at `/library/<slug>` for a client
 * whose `Accept` names `text/markdown`), via the rewrites in `next.config.ts`. Drafts and unknown
 * slugs are a Markdown 404. Uncached, like the HTML post page: the same body answers at the post's
 * own URL, so a cache that ignores `Vary` must never keep it.
 */
export const GET = withRouteHandler(async (_request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const [posts, source] = await Promise.all([getAllPostMeta(), getPostSource(slug)])
  const post = posts.find((candidate) => candidate.slug === slug)
  const response =
    post && source !== null
      ? markdownResponse(postMarkdownBlocks(post, source), 0)
      : new Response(NOT_FOUND_MARKDOWN, {
          status: 404,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Vary', 'Accept')
  if (post) response.headers.set('Link', `<${post.canonical}>; rel="canonical"`)
  return response
})
