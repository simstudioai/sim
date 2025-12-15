import type { InferPageType } from 'fumadocs-core/source'
import type { PageData, source } from '@/lib/source'

export async function getLLMText(page: InferPageType<typeof source>) {
  const data = page.data as PageData
  const processed = await data.getText('processed')
  return `# ${data.title} (${page.url})

${processed}`
}
