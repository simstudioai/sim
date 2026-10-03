import { SITE_URL, toSiteUrl } from '@/lib/core/utils/urls'
import { INTEGRATION_COUNT_LABEL } from '@/lib/landing/constants'
import type { NavMenu } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import { COMPLIANCE_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/compliance/compliance'
import { ENGINEERING_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/engineering/engineering'
import { FINANCE_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/finance/finance'
import { HR_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/hr/hr'
import { IT_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/it/it'
import { SALES_PAGE_DESCRIPTION } from '@/app/(landing)/solutions/sales/sales'

/** Shared building blocks for `/llms.txt` and `/llms-full.txt` (https://llmstxt.org). */

const SIM_SUMMARY = `Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect ${INTEGRATION_COUNT_LABEL} integrations and every major LLM to create agents that automate real work — visually, conversationally, or with code.`

/** The H1 and blockquote summary every llms.txt variant opens with. */
export const LLMS_HEADER = `# Sim\n\n> ${SIM_SUMMARY}`

const SOLUTIONS = [
  {
    title: 'AI agents for compliance',
    path: '/solutions/compliance',
    description: COMPLIANCE_PAGE_DESCRIPTION,
  },
  {
    title: 'AI agents for engineering',
    path: '/solutions/engineering',
    description: ENGINEERING_PAGE_DESCRIPTION,
  },
  {
    title: 'AI agents for finance',
    path: '/solutions/finance',
    description: FINANCE_PAGE_DESCRIPTION,
  },
  { title: 'AI agents for HR', path: '/solutions/hr', description: HR_PAGE_DESCRIPTION },
  { title: 'AI agents for IT', path: '/solutions/it', description: IT_PAGE_DESCRIPTION },
  { title: 'AI agents for sales', path: '/solutions/sales', description: SALES_PAGE_DESCRIPTION },
] as const

/** One llms.txt entry per `/solutions/*` page. */
export const SOLUTION_LINES = SOLUTIONS.map((s) => linkLine(s.title, s.path, s.description))

/** One llms.txt list entry: `- [title](url): description`. */
export function linkLine(title: string, href: string, description?: string): string {
  return `- [${title}](${toSiteUrl(href)})${description ? `: ${description}` : ''}`
}

/**
 * A `## heading` followed by its entries, or nothing when there are none.
 * List lines join with a newline; pass `'\n\n'` for multi-paragraph blocks.
 */
export function section(heading: string, entries: readonly string[], separator = '\n'): string {
  return entries.length > 0 ? `## ${heading}\n\n${entries.join(separator)}` : ''
}

/** Every item of a navbar menu as an llms.txt link line. */
export function navMenuLines(menu: NavMenu): string[] {
  return menu.sections.flatMap((s) =>
    s.items.map((item) =>
      linkLine(item.brand ? `${item.brand} ${item.title}` : item.title, item.href, item.description)
    )
  )
}

/**
 * Prepares a post's raw markdown for llms-full.txt: headings demoted by
 * `demoteBy` levels so they nest under the caller's title, and site-relative
 * links and images made absolute.
 */
export function toLlmsMarkdown(source: string, demoteBy: number): string {
  let inFence = false
  return source
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      return line
        .replace(
          /^(#{1,6}) /,
          (_, hashes: string) => `${'#'.repeat(Math.min(6, hashes.length + demoteBy))} `
        )
        .replace(/\]\(\/(?!\/)/g, `](${SITE_URL}/`)
    })
    .join('\n')
    .trim()
}

/** Joins non-empty blocks into one markdown document and serves it with shared cache headers. */
export function markdownResponse(blocks: readonly string[], revalidateSeconds: number): Response {
  return new Response(`${blocks.filter(Boolean).join('\n\n')}\n`, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': `public, s-maxage=${revalidateSeconds}, stale-while-revalidate=${revalidateSeconds}`,
    },
  })
}
