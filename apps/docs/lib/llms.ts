import type { InferPageType } from 'fumadocs-core/source'
import type { source } from '@/lib/source'

export async function getLLMText(page: InferPageType<typeof source>) {
  return `# ${page.data.title} (${page.url})

${page.data.description || ''}

${page.data.content || ''}`
}
