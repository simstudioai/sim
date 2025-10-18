import type { InferPageType } from 'fumadocs-core/source'
import { remarkInclude } from 'fumadocs-mdx/config'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import type { source } from '@/lib/source'

const processor = remark().use(remarkMdx).use(remarkInclude).use(remarkGfm)

export async function getLLMText(page: InferPageType<typeof source>) {
  // Skip pages without proper file data
  if (!page?.data?._file?.absolutePath || !page?.data?.content) {
    return `# ${page.data.title || 'Untitled'}
URL: ${page.url || 'Unknown'}

${page.data.description || 'No description available'}`
  }

  try {
    const processed = await processor.process({
      path: page.data._file.absolutePath,
      value: page.data.content,
    })

    return `# ${page.data.title || 'Untitled'}
URL: ${page.url || 'Unknown'}

${page.data.description || ''}

${processed.value}`
  } catch (error) {
    console.error(`Error processing page ${page.url}:`, error)
    return `# ${page.data.title || 'Untitled'}
URL: ${page.url || 'Unknown'}

${page.data.description || 'No description available'}`
  }
}
