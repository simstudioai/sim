import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { listPeopleContract, type PersonSummary } from '@/lib/api/contracts/people'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { getPerson, listPeople } from '@/lib/people/application/use-cases'
import { isPeopleEnabled } from '@/lib/people/feature-flag'
import type { PersonRecord } from '@/lib/people/repository'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

/** Said when a query matches no one, so a caller looks for people outside the organization in search. */
export const NO_PEOPLE_MATCH_NOTE =
  'No one in this organization’s directory matches. The directory lists only people in this organization; search connected sources for anyone else, such as customer or vendor contacts.'

const logger = createLogger('PeopleDirectoryLookup')

/**
 * Whether `principal` may look people up in `organizationId`: People is on there and the
 * directory is open to them. Asked before offering a lookup tool, so a caller whose organization
 * has no People directory, or who may not browse it, is never offered one. A check that fails
 * hides the tool rather than failing the listing or turn around it.
 */
export async function canLookUpPeople(
  principal: Principal,
  organizationId: string
): Promise<boolean> {
  try {
    if (!(await isPeopleEnabled(organizationId))) return false
    await listPeople.authorize({ principal, input: { organizationId } })
    return true
  } catch (error) {
    if (!(error instanceof OrchestrationError))
      logger.warn('Could not resolve People directory access', {
        organizationId,
        error: getErrorMessage(error),
      })
    return false
  }
}

interface DirectoryLookupInput {
  principal: Principal
  organizationId: string
  request?: OrchestrationRequestContext
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
    directReports: report.reportCount,
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

/** One person with their reporting line: managers above them, direct manager first, and reports. */
export async function readDirectoryPerson({
  principal,
  organizationId,
  request,
  personId,
}: DirectoryLookupInput & { personId: string }) {
  const { person, chain, reports, totalReports } = await getPerson.execute({
    principal,
    input: { organizationId, memberId: personId },
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

/**
 * Finds people in the organization's directory through the People page's use cases. A first page
 * holding exactly one person answers with that person's reporting line, so "who is X's manager" or
 * "who reports to X" takes one call. The cursor resumes only the organization and query it was
 * minted for.
 */
export async function findDirectoryPeople({
  principal,
  organizationId,
  request,
  query,
  cursor,
}: DirectoryLookupInput & { query?: string; cursor?: string }) {
  const scope = cursorScopeKey(cursorRoute(listPeopleContract, { id: organizationId }), {
    search: query,
  })
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
    return readDirectoryPerson({ principal, organizationId, request, personId: only.memberId })
  const nextCursor = writeSortedCursor(page.nextCursorKeys, 'name', 'asc', scope)
  return {
    people: page.data.map((person) => ({
      ...personFacts(person),
      ...(person.manager ? { manager: person.manager.name } : {}),
    })),
    ...(nextCursor ? { nextCursor } : {}),
    ...(page.data.length ? {} : { note: NO_PEOPLE_MATCH_NOTE }),
  }
}
