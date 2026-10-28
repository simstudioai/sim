import { INTEGRATION_REACH } from '@sim/deployment-config/integration-claims'
import { createLogger } from '@sim/logger'
import { source } from '@/lib/source'
import { DOCS_BASE_URL, SIM_SITE_URL } from '@/lib/urls'

const logger = createLogger('DocsLlmsManifest')

export const revalidate = false

export async function GET() {
  const baseUrl = DOCS_BASE_URL

  try {
    const pages = source.getPages().filter((page) => Boolean(page?.data && page.url))

    const sections: Record<string, Array<{ title: string; url: string; description?: string }>> = {}

    pages.forEach((page) => {
      const section = page.url.split('/').filter(Boolean)[0] || 'root'

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

> The open-source AI workspace where teams build, deploy, and manage AI agents.

Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Connect ${INTEGRATION_REACH} and every major LLM to create agents that automate real work — visually, conversationally, or with code. Trusted by over 100,000 builders.

## Calling the Sim API

- Sim Cloud base URL: \`${SIM_SITE_URL}\`. For self-hosted deployments, use your deployment's origin instead, including in the example below. Every endpoint is under \`/api\`; there is no \`api.sim.ai\` host.
- Run a deployed workflow: \`POST ${SIM_SITE_URL}/api/v2/workflows/{workflowId}/execute\` with a JSON body like \`{ "input": { "fieldName": "value" } }\`.
- Authenticate API keys with the \`X-API-Key\` header. \`Authorization: Bearer\` accepts only Sim OAuth access tokens, never API keys.
- Responses wrap the payload in \`data\`. A synchronous run returns \`200 { "data": { "runId", "status", "output", ... } }\`; with \`"async": true\` in the body it returns \`202 { "data": { "runId", "statusUrl" } }\` and you poll \`statusUrl\`.
- SDKs: \`simstudio-ts-sdk\` (npm) and \`simstudio-sdk\` (PyPI). Full reference: [API getting started](${baseUrl}/api-reference/getting-started).

## Documentation Overview

This file provides an overview of our documentation. For the full content of every guide and integration page, see [llms-full.txt](${baseUrl}/llms-full.txt). API reference operations are not in it: each one is served as markdown at its page URL with \`.md\` appended, e.g. ${baseUrl}/api-reference/tables/countTableRows.md.

## Main Sections

${Object.entries(sections)
  .map(([section, items]) => {
    const sectionTitle = section
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `### ${sectionTitle}\n\n${items.map((item) => `- [${item.title}](${item.url})${item.description ? `\n  ${item.description}` : ''}`).join('\n')}`
  })
  .join('\n\n')}

## Additional Resources

- [Full documentation content, excluding API reference operations](${baseUrl}/llms-full.txt)
- Individual page content as markdown: ${baseUrl}/[page-path].md
- [API documentation](${baseUrl}/api-reference/getting-started)
- [Integrations](${baseUrl}/integrations)

## Statistics

- Total pages: ${pages.length}

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
    logger.error('Error generating LLM manifest:', error)
    return new Response('Error generating documentation manifest', { status: 500 })
  }
}
