import { CREDIT_TIERS } from '@/lib/billing/constants'
import type { CompetitorProfile, Fact, Prose } from '@/lib/compare/data'
import { simProfile } from '@/lib/compare/data'
import { toSiteUrl } from '@/lib/core/utils/urls'
import { getAllCustomerStoryMeta, getCustomerStorySource } from '@/lib/customers/registry'
import { DOCS_URL } from '@/lib/help-links'
import {
  getAllPostMeta as getAllLibraryPostMeta,
  getPostSource as getLibraryPostSource,
} from '@/lib/library/registry'
import { COMPARISON_SECTIONS, getFactGroup } from '@/app/(landing)/comparisons/comparison-sections'
import {
  ALL_COMPETITORS,
  buildBottomLine,
  getLatestVerifiedDate,
  SIM_LATEST_VERIFIED,
} from '@/app/(landing)/comparisons/utils'
import { PLATFORM_MENU } from '@/app/(landing)/components/navbar/components/nav-menu-chip'
import {
  LLMS_HEADER,
  linkLine,
  markdownResponse,
  navMenuLines,
  SOLUTION_LINES,
  section,
  toLlmsMarkdown,
} from '@/app/llms.txt/llms'

export const dynamic = 'force-static'
export const revalidate = 86400

const CONCEPTS = [
  [
    'Workspace',
    'The container for a team’s agents, workflows, knowledge bases, tables, files, credentials, and run history.',
  ],
  [
    'Chat',
    'Talk to Sim in natural language to build, run, and manage everything in the workspace.',
  ],
  [
    'Workflow',
    'The agent logic built in the visual builder: blocks connected into a graph that runs from a trigger.',
  ],
  [
    'Block',
    'One step in a workflow, such as an Agent (LLM call with tools), Function (code), API request, Condition, Router, Loop, or Parallel.',
  ],
  [
    'Trigger',
    'What starts a run: a manual run, a schedule, a webhook, an API call, a chat message, or an event in a connected app.',
  ],
  [
    'Knowledge Base',
    'Documents uploaded or synced from sources such as Notion, Google Drive, and Confluence, searchable by agents.',
  ],
  ['Tables', 'A built-in database agents read and update while they work.'],
  ['Logs', 'Every run traced block by block, with inputs, outputs, cost, and duration.'],
] as const

function proseToMarkdown(prose: Prose): string {
  return prose
    .map((segment) =>
      typeof segment === 'string' ? segment : `[${segment.text}](${toSiteUrl(segment.href)})`
    )
    .join('')
}

/** A fact as a table cell: its compact form, as the comparison table renders it. */
function factCell(fact: Fact | undefined): string {
  const value = fact ? (fact.shortValue ?? fact.value) : 'Unknown'
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The key facts of one `/comparisons/{id}` page as markdown, from the same profile data. */
function comparisonMarkdown(competitor: CompetitorProfile): string {
  const verdict = buildBottomLine(competitor)
  const verified = new Date(
    Math.max(SIM_LATEST_VERIFIED.getTime(), getLatestVerifiedDate(competitor).getTime())
  )
  const rows = COMPARISON_SECTIONS.flatMap((s) => {
    const sim = getFactGroup(simProfile, s.group)
    const other = getFactGroup(competitor, s.group)
    return s.rows.map(
      (row) =>
        `| ${s.title}: ${row.label} | ${factCell(sim[row.key])} | ${factCell(other[row.key])} |`
    )
  })

  return [
    `### Sim vs ${competitor.name}`,
    `URL: ${toSiteUrl(`/comparisons/${competitor.id}`)} · Facts last verified ${isoDate(verified)}`,
    `${competitor.name}: ${competitor.oneLiner}`,
    competitor.leadAnswer ? proseToMarkdown(competitor.leadAnswer) : '',
    competitor.betterThanAnswer ? proseToMarkdown(competitor.betterThanAnswer) : '',
    `- ${verdict.chooseSim}\n- ${verdict.chooseCompetitor}`,
    competitor.standoutFeatures.length > 0
      ? `Standout features of ${competitor.name}:\n\n${competitor.standoutFeatures.map((f) => `- ${f.title}: ${f.description}`).join('\n')}`
      : '',
    competitor.limitations.length > 0
      ? `Documented limitations of ${competitor.name}:\n\n${competitor.limitations.map((l) => `- ${l.title}: ${l.description}`).join('\n')}`
      : '',
    [`| Feature | Sim | ${competitor.name} |`, '| --- | --- | --- |', ...rows].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * `/llms-full.txt`: the substantive public content in one markdown file for AI
 * engines to ingest — product overview, the full text of every published
 * library article and customer story, and the sourced facts behind every
 * comparison page. Generated from the content registries and comparison data,
 * so retired articles and new comparisons track automatically.
 */
export async function GET() {
  const [libraryPosts, customerStories] = await Promise.all([
    getAllLibraryPostMeta(),
    getAllCustomerStoryMeta(),
  ])
  const toBody = (source: string | null) => toLlmsMarkdown(source ?? '', 2)
  const [libraryBodies, customerBodies] = await Promise.all([
    Promise.all(libraryPosts.map((p) => getLibraryPostSource(p.slug).then(toBody))),
    Promise.all(customerStories.map((s) => getCustomerStorySource(s.slug).then(toBody))),
  ])

  const [pro, max] = CREDIT_TIERS

  return markdownResponse(
    [
      LLMS_HEADER,
      `This file holds the full text of Sim’s public library, customer stories, and comparison facts. The link index is [llms.txt](${toSiteUrl('/llms.txt')}); the product documentation is at [${DOCS_URL}/llms-full.txt](${DOCS_URL}/llms-full.txt).`,
      section('Overview', [
        'Teams build agents in the visual workflow builder, by talking to Sim in Chat, or with code through the API and SDKs. Sim is open source under the Apache 2.0 license and runs as a managed cloud service or self-hosted with Docker or Kubernetes.',
        '',
        ...CONCEPTS.map(([term, definition]) => `- **${term}**: ${definition}`),
      ]),
      section('Platform', navMenuLines(PLATFORM_MENU)),
      section('Pricing', [
        linkLine('Pricing', '/pricing'),
        '- Free: $0 to start building agents.',
        `- ${pro.name}: $${pro.dollars} per user per month, ${pro.credits.toLocaleString('en-US')} credits.`,
        `- ${max.name}: $${max.dollars} per user per month, ${max.credits.toLocaleString('en-US')} credits.`,
        '- Enterprise: custom limits, infrastructure, and governance for large organizations.',
      ]),
      section('Solutions', SOLUTION_LINES),
      section(
        'Customer stories',
        customerStories.map((story, i) =>
          [`### ${story.title}`, `URL: ${story.canonical}`, customerBodies[i]].join('\n\n')
        ),
        '\n\n'
      ),
      section('Comparisons', ALL_COMPETITORS.map(comparisonMarkdown), '\n\n'),
      section(
        'Library',
        libraryPosts.map((p, i) =>
          [
            `### ${p.title}`,
            `URL: ${p.canonical} · Updated ${(p.updated ?? p.date).slice(0, 10)}`,
            `> ${p.description}`,
            libraryBodies[i],
          ].join('\n\n')
        ),
        '\n\n'
      ),
    ],
    revalidate
  )
}
