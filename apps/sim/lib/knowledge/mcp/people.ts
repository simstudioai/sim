import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  organizationKnowledgeMcpContract,
  searchPeopleMcpSchema,
} from '@/lib/api/contracts/knowledge/mcp'
import type { PersonSummary } from '@/lib/api/contracts/people'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  KNOWLEDGE_MCP_READ_ONLY,
  type KnowledgeMcpToolRunner,
  projectResult,
} from '@/lib/knowledge/mcp/tool-runner'
import { getPerson, listPeople } from '@/lib/people/application/use-cases'
import { isPeopleEnabled } from '@/lib/people/feature-flag'
import type { PersonRecord } from '@/lib/people/repository'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

const logger = createLogger('KnowledgeMcpPeople')

/** Said when a query matches no one, so a client looks for people outside the organization in search. */
export const NO_PEOPLE_MATCH_NOTE =
  'No one in this organization’s directory matches. The directory lists only people in this organization; use search for anyone else, such as customer or vendor contacts.'

/**
 * Whether `principal` may look people up in `organizationId`: People is on there and the
 * directory is open to them. Asked when listing tools, so a client whose organization has no
 * People directory, or who may not browse it, is never offered the tool. A lookup that fails hides
 * the tool rather than failing the listing around it.
 */
export async function canSearchPeople(
  principal: Principal,
  organizationId: string
): Promise<boolean> {
  try {
    if (!(await isPeopleEnabled(organizationId))) return false
    await listPeople.authorize({ principal, input: { organizationId } })
    return true
  } catch (error) {
    if (!(error instanceof OrchestrationError))
      logger.warn('Could not resolve Search MCP people access', {
        organizationId,
        error: getErrorMessage(error),
      })
    return false
  }
}

function summaryFacts(person: PersonSummary) {
  return {
    personId: person.memberId,
    name: person.name,
    ...(person.title ? { title: person.title } : {}),
  }
}

function reportFacts(report: PersonSummary & { department: string | null; reportCount: number }) {
  return {
    ...summaryFacts(report),
    ...(report.department ? { department: report.department } : {}),
    ...(report.reportCount ? { directReports: report.reportCount } : {}),
  }
}

function personFacts(person: PersonRecord) {
  const { department, location, startDate } = person
  return {
    ...summaryFacts(person),
    email: person.email,
    ...(department ? { department } : {}),
    ...(location ? { location } : {}),
    ...(startDate ? { startDate } : {}),
  }
}

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
  const detail = async (memberId: string) => {
    const { person, chain, reports, totalReports } = await getPerson.execute({
      principal,
      input: { organizationId, memberId },
      request,
    })
    return {
      person: {
        ...personFacts(person),
        ...(chain.length ? { managerChain: chain.map(summaryFacts) } : {}),
        ...(reports.length ? { directReports: reports.map(reportFacts) } : {}),
        totalDirectReports: totalReports,
        ...(totalReports > reports.length
          ? {
              note: `directReports lists the first ${reports.length} of ${totalReports}; search by department or title to find the others.`,
            }
          : {}),
      },
    }
  }

  server.registerTool(
    'search_people',
    {
      title: 'Search people',
      description:
        'Look up people in this organization’s directory by name, email, title, department, or location. Returns each person’s title, department, location, email, and manager. When exactly one person matches, or with a personId, returns that person with managerChain (direct manager first) and directReports. Covers only this organization’s people; use search for customers, vendors, and other outside contacts.',
      inputSchema: searchPeopleMcpSchema,
      annotations: KNOWLEDGE_MCP_READ_ONLY,
    },
    async (input: unknown, extra: { signal: AbortSignal }) => {
      const personId = searchPeopleMcpSchema.safeParse(input).data?.personId
      if (personId)
        return execute('search_people', getPerson.operation, extra.signal, async (registry) =>
          projectResult(await detail(personId), registry)
        )
      return execute('search_people', listPeople.operation, extra.signal, async (registry) => {
        const { query, cursor } = searchPeopleMcpSchema.parse(input)
        const scope = cursorScopeKey(
          cursorRoute(organizationKnowledgeMcpContract, { organizationId }),
          { tool: 'search_people', query }
        )
        const page = await listPeople.execute({
          principal,
          input: {
            organizationId,
            search: query,
            cursorKeys: readSortedCursor(cursor, 'name', 'asc', scope),
          },
          request,
        })
        const [only] = page.data
        if (only && page.data.length === 1 && !cursor)
          return projectResult(await detail(only.memberId), registry)
        const nextCursor = writeSortedCursor(page.nextCursorKeys, 'name', 'asc', scope)
        return projectResult(
          {
            people: page.data.map((person) => ({
              ...personFacts(person),
              ...(person.manager ? { manager: person.manager.name } : {}),
            })),
            ...(nextCursor ? { nextCursor } : {}),
            ...(page.data.length ? {} : { note: NO_PEOPLE_MATCH_NOTE }),
          },
          registry
        )
      })
    }
  )
}
