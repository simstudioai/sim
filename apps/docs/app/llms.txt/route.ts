import { source } from '@/lib/source'

export const revalidate = false

export async function GET() {
  const baseUrl = 'https://docs.sim.ai'

  try {
    const pages = source.getPages().filter((page) => {
      if (!page || !page.data || !page.url) return false

      const pathParts = page.url.split('/').filter(Boolean)
      const hasLangPrefix = pathParts[0] && ['es', 'fr', 'de', 'ja', 'zh'].includes(pathParts[0])

      return !hasLangPrefix
    })

    const sections: Record<string, Array<{ title: string; url: string; description?: string }>> = {}

    pages.forEach((page) => {
      const pathParts = page.url.split('/').filter(Boolean)
      const section =
        pathParts[0] && ['en', 'es', 'fr', 'de', 'ja', 'zh'].includes(pathParts[0])
          ? pathParts[1] || 'root'
          : pathParts[0] || 'root'

      if (!sections[section]) {
        sections[section] = []
      }

      sections[section].push({
        title: page.data.title || 'Untitled',
        url: `${baseUrl}${page.url}`,
        description: page.data.description,
      })
    })

    const manifest = `# Sim Documentation

> Visual Workflow Builder for AI Applications

Sim is a visual workflow builder for AI applications that lets you build AI agent workflows visually. Create powerful AI agents, automation workflows, and data processing pipelines by connecting blocks on a canvas—no coding required.

## Documentation Overview

This file provides an overview of our documentation. For full content of all pages, see ${baseUrl}/llms-full.txt

## Main Sections

${Object.entries(sections)
  .map(([section, items]) => {
    const sectionTitle = section
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `### ${sectionTitle}\n\n${items.map((item) => `- ${item.title}: ${item.url}${item.description ? `\n  ${item.description}` : ''}`).join('\n')}`
  })
  .join('\n\n')}

## Additional Resources

- Full documentation content: ${baseUrl}/llms-full.txt
- Individual page content: ${baseUrl}/llms.mdx/[page-path]
- API documentation: ${baseUrl}/sdks/
- Tool integrations: ${baseUrl}/tools/

## Statistics

- Total pages: ${pages.length} (English only)
- Other languages available at: ${baseUrl}/[lang]/ (es, fr, de, ja, zh)

---

Generated: ${new Date().toISOString()}
Format: llms.txt v0.1.0
See: https://llmstxt.org for specification`

    return new Response(manifest, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  } catch (error) {
    console.error('Error generating LLM manifest:', error)
    return new Response('Error generating documentation manifest', { status: 500 })
  }
}
