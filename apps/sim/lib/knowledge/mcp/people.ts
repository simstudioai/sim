import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import { searchPeopleInputSchema } from '@/lib/api/contracts/mothership-assistant-tools'
import {
  KNOWLEDGE_MCP_READ_ONLY,
  type KnowledgeMcpToolRunner,
  projectResult,
} from '@/lib/knowledge/mcp/tool-runner'
import { getPerson, listPeople } from '@/lib/people/application/use-cases'
import { findDirectoryPeople, readDirectoryPerson } from '@/lib/people/directory-lookup'

interface SearchPeopleToolContext {
  execute: KnowledgeMcpToolRunner
  principal: Principal
  organizationId: string
  request: NextRequest
}

/**
 * Registers `search_people`: the organization's People directory through the same use cases the
 * People page reads. A query that finds one person, or a personId, returns that person with their
 * reporting line, so "who is X's manager" or "who reports to X" takes one call.
 */
export function registerSearchPeopleTool(
  server: McpServer,
  { execute, principal, organizationId, request }: SearchPeopleToolContext
) {
  server.registerTool(
    'search_people',
    {
      title: 'Search people',
      description:
        'Look up people in this organization’s directory by name, email, title, department, or location. Returns each person’s title, department, location, email, and manager. When exactly one person matches, or with a personId, returns that person with managerChain (direct manager first) and directReports. Covers only this organization’s people; use search for customers, vendors, and other outside contacts.',
      inputSchema: searchPeopleInputSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (input: unknown, extra: { signal: AbortSignal }) => {
      const personId = searchPeopleInputSchema.safeParse(input).data?.personId
      if (personId)
        return execute('search_people', getPerson.operation, extra.signal, async (registry) =>
          projectResult(
            await readDirectoryPerson({ principal, organizationId, request, personId }),
            registry
          )
        )
      return execute('search_people', listPeople.operation, extra.signal, async (registry) => {
        const { query, cursor } = searchPeopleInputSchema.parse(input)
        return projectResult(
          await findDirectoryPeople({ principal, organizationId, request, query, cursor }),
          registry
        )
      })
    }
  )
}
