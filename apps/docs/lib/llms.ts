import type { InferPageType } from 'fumadocs-core/source'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { getIntegrationLandingPage, INTEGRATION_LANDING_LABEL } from '@/lib/integration-landing'
import { getApiSpecContent } from '@/lib/openapi'
import type { PageData, source } from '@/lib/source'

/** A table row, captured as its indentation (tables nest under list items) and its cells. */
const TABLE_ROW = /^(\s*)\|(.*)\|$/
const TABLE_DELIMITER_CELL = /^\s*(:?)-+(:?)\s*$/
const UNESCAPED_PIPE = /(?<!\\)\|/

/**
 * The processed-markdown serializer pads every table cell to its column's widest cell, so one long
 * enum (a parameter listing every timezone) pads every row of its table and roughly doubles the
 * integration reference. Drop that trailing padding; a cell's own leading indentation (the `↳`
 * nesting in output tables) and inline code are kept, and the tables stay valid GFM. Tables and
 * fences nested under a list item are indented, so both are matched after their indentation.
 */
function compactTables(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) inFence = !inFence
      const row = inFence ? null : TABLE_ROW.exec(line)
      if (!row) return line
      const [, indent, inner] = row
      const cells = inner.split(UNESCAPED_PIPE)
      if (cells.every((cell) => TABLE_DELIMITER_CELL.test(cell))) {
        return `${indent}|${cells.map((cell) => cell.replace(TABLE_DELIMITER_CELL, ' $1---$2 ')).join('|')}|`
      }
      return `${indent}|${cells.map((cell) => ` ${cell.replace(/^ /, '').trimEnd()} `).join('|')}|`
    })
    .join('\n')
}

type LLMPageData = PageData & { getAPIPageProps?: () => ApiPageProps }

/**
 * OpenAPI operation pages are virtual: no MDX body, and a fully resolved request/response schema
 * (~40 KB each, mostly shared components) that is useful per page but would double `llms-full.txt`.
 */
export function isApiOperationPage(page: InferPageType<typeof source>): boolean {
  return typeof (page.data as unknown as LLMPageData).getAPIPageProps === 'function'
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const data = page.data as unknown as LLMPageData
  const heading = `# ${data.title} (${page.url})`

  // Operation pages get the same markdown the page's "Copy page" action builds.
  if (typeof data.getAPIPageProps === 'function') {
    const spec = getApiSpecContent(
      data.title,
      data.description,
      data.getAPIPageProps().operations ?? []
    )
    return spec.replace(/^# .*$/m, heading)
  }

  if (typeof data.getText !== 'function') return ''
  const processed = await data.getText('processed')
  const landingPage = getIntegrationLandingPage(page.slugs)
  const landingLink = landingPage
    ? `${INTEGRATION_LANDING_LABEL} [${landingPage.title}](${landingPage.url})\n\n`
    : ''
  return `${heading}

${landingLink}${compactTables(processed)}`
}
