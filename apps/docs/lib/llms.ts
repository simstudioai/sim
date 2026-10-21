import type { InferPageType } from 'fumadocs-core/source'
import type { ApiPageProps } from 'fumadocs-openapi/ui'
import { getApiSpecContent } from '@/lib/openapi'
import type { PageData, source } from '@/lib/source'

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
  return `${heading}

${processed}`
}
