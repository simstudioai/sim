import { createLogger } from '@/lib/logs/console/logger'
import { tools } from '@/tools/registry'

const logger = createLogger('ToolSearch')

/**
 * Tool search function - implements BM25-like search over tool names and descriptions
 * This enables Claude to discover tools on-demand instead of loading all 663+ tools upfront
 */
export function searchTools(
  query: string,
  maxResults = 20
): Array<{
  id: string
  name: string
  description: string
  score: number
  requiresOAuth: boolean
  provider?: string
}> {
  const normalizedQuery = query.toLowerCase().trim()
  const queryTerms = normalizedQuery.split(/\s+/)

  const results: Array<{
    id: string
    name: string
    description: string
    score: number
    requiresOAuth: boolean
    provider?: string
  }> = []

  for (const [toolId, toolConfig] of Object.entries(tools)) {
    const name = toolConfig.name?.toLowerCase() || toolId.toLowerCase()
    const description = toolConfig.description?.toLowerCase() || ''
    const searchText = `${name} ${description}`

    // Calculate relevance score
    let score = 0

    // Exact match in tool ID or name gets highest score
    if (toolId.toLowerCase().includes(normalizedQuery)) score += 100
    if (name.includes(normalizedQuery)) score += 80

    // Term matching with TF-IDF-like scoring
    for (const term of queryTerms) {
      if (term.length < 2) continue

      const nameMatches = (name.match(new RegExp(term, 'g')) || []).length
      const descMatches = (description.match(new RegExp(term, 'g')) || []).length

      score += nameMatches * 20
      score += descMatches * 5

      // Bonus for word boundary matches
      if (new RegExp(`\\b${term}\\b`).test(searchText)) {
        score += 15
      }
    }

    if (score > 0) {
      results.push({
        id: toolId,
        name: toolConfig.name || toolId,
        description: toolConfig.description || 'No description available',
        score,
        requiresOAuth: !!toolConfig.oauth?.required,
        provider: toolConfig.oauth?.provider,
      })
    }
  }

  // Sort by score descending and return top results
  const topResults = results.sort((a, b) => b.score - a.score).slice(0, maxResults)

  logger.info('Tool search completed', {
    query,
    resultsFound: topResults.length,
    topTools: topResults.slice(0, 3).map((r) => r.id),
  })

  return topResults
}

/**
 * Server-side tool definition for tool search
 * This is registered as a callable tool for Claude
 */
export const searchToolsDefinition = {
  id: 'search_tools',
  name: 'Search Available Tools',
  description: `Search through 600+ available integration tools by name or description. Use this to discover what tools are available before using them.

Available tool categories include:
- GitHub (repos, PRs, issues, actions, workflows)
- Slack (messages, channels, users, files)
- Google (Drive, Gmail, Calendar, Sheets, Docs)
- Airtable, Apollo, Asana, Calendly, Clay
- Discord, Confluence, Jira, Linear, Notion
- Salesforce, Stripe, HubSpot, Intercom
- And 600+ more integrations

IMPORTANT: Always search for tools first to find the right integration for your task. After finding tools, you can call them directly using their tool_id.`,
  params: {},
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'Search query to find relevant tools (e.g., "github create pr", "slack send message", "google drive list files")',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20, max: 50)',
      },
    },
    required: ['query'],
  },
  execute: searchTools,
}
