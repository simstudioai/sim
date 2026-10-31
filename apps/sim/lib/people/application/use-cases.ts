import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { PeopleImportResult } from '@/lib/api/contracts/people'
import type { CursorKey } from '@/lib/api/list-query'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationMemberDirectory } from '@/lib/organizations/application/reads'
import { peopleOperations } from '@/lib/people/application/operations'
import { requirePeopleEnabled } from '@/lib/people/feature-flag'
import { matchPeopleColumns, type PeopleImportMember, planPeopleImport } from '@/lib/people/import'
import * as repository from '@/lib/people/repository'
import type { MemberProfileFields } from '@/lib/people/validation'

interface OrganizationInput {
  organizationId: string
}
interface PersonInput extends OrganizationInput {
  memberId: string
}

/** Issues past this many are counted, not listed, so a broken file can't flood the response. */
const MAX_REPORTED_ISSUES = 200

async function authorizeDirectory<I extends OrganizationInput>({
  input,
  context,
}: OrganizationUseCaseContext<I>): Promise<void> {
  await Promise.all([
    requirePeopleEnabled(input.organizationId),
    requireOrganizationMemberDirectory(input.organizationId, context.role),
  ])
}

const authorizeAdministration = <I extends OrganizationInput>({
  input,
}: OrganizationUseCaseContext<I>) => requirePeopleEnabled(input.organizationId)

export const listPeople = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.list,
  authorizeResource: authorizeDirectory,
  execute: ({
    input,
  }: OrganizationUseCaseContext<
    OrganizationInput & { search?: string; department?: string; cursorKeys?: CursorKey[] }
  >) => repository.listPeople(input.organizationId, input),
})

/** The departments people belong to, with head counts, for filtering the People page. */
export const listDepartments = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.listDepartments,
  authorizeResource: authorizeDirectory,
  execute: ({ input }: OrganizationUseCaseContext<OrganizationInput>) =>
    repository.listDepartments(input.organizationId),
})

/**
 * One person with the managers above them and the people who report to them, read from one
 * snapshot so a reporting-line edit made meanwhile can't leave the three disagreeing.
 */
export const getPerson = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.get,
  authorizeResource: authorizeDirectory,
  async execute({ input }: OrganizationUseCaseContext<PersonInput>) {
    const { organizationId, memberId } = input
    const { person, chain, reports } = await db.transaction(
      async (tx) => ({
        person: await repository.getPerson(tx, organizationId, memberId),
        chain: await repository.getReportingChain(tx, organizationId, memberId),
        reports: await repository.listDirectReports(tx, organizationId, memberId),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
    if (!person) throw new OrchestrationError('not_found', 'Person not found')
    return { person, chain, reports }
  },
})

/**
 * Replaces one member's profile. The manager must be another active member of the same
 * organization who doesn't already report, directly or not, to this person.
 */
export const updatePerson = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.update,
  authorizeResource: authorizeAdministration,
  async execute({ input, context }: OrganizationUseCaseContext<PersonInput & MemberProfileFields>) {
    const { organizationId, memberId, ...fields } = input
    const { managerMemberId } = fields
    if (managerMemberId === memberId) {
      throw new OrchestrationError('validation', "A person can't be their own manager")
    }
    return db.transaction(async (tx) => {
      await repository.lockProfiles(tx, organizationId)
      const active = await repository.findActiveMembers(
        tx,
        organizationId,
        managerMemberId ? [memberId, managerMemberId] : [memberId]
      )
      if (!active.has(memberId)) throw new OrchestrationError('not_found', 'Person not found')
      if (managerMemberId && !active.has(managerMemberId)) {
        throw new OrchestrationError(
          'validation',
          'The manager must be a member of this organization'
        )
      }
      if (managerMemberId && (await repository.isInReportingChain(tx, memberId, managerMemberId))) {
        throw new OrchestrationError('validation', 'That manager reports to this person')
      }
      await repository.upsertProfiles(tx, [{ memberId, ...fields }], context.userId)
      const person = await repository.getPerson(tx, organizationId, memberId)
      if (!person) throw new OrchestrationError('not_found', 'Person not found')
      return person
    })
  },
  projectAudit: ({ result, input }) => ({
    action: AuditAction.ORG_MEMBER_PROFILE_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.name,
    description: `Updated the profile of ${result.name}`,
    metadata: {
      memberId: input.memberId,
      title: input.title,
      department: input.department,
      location: input.location,
      startDate: input.startDate,
      managerMemberId: input.managerMemberId,
    },
  }),
})

/**
 * Imports people data from a spreadsheet's rows, matched to active members by email. A preview
 * (`apply: false`) reports what would change and writes nothing; applying re-plans under the
 * profile lock against current data, so fields the file leaves out keep any change made since the
 * preview, and reporting loops are checked against current managers.
 */
export const importPeople = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.import,
  authorizeResource: authorizeAdministration,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<
    OrganizationInput & { headers: string[]; rows: string[][]; apply: boolean }
  >): Promise<PeopleImportResult> {
    const matched = matchPeopleColumns(input.headers)
    if (!matched.ok) throw new OrchestrationError('validation', matched.message)
    const rows = input.rows.map((cells) =>
      Object.fromEntries(input.headers.map((header, index) => [header, cells[index] ?? '']))
    )
    const plan = (members: PeopleImportMember[]) =>
      planPeopleImport({ columns: matched.columns, rows, members })
    const result = input.apply
      ? await db.transaction(async (tx) => {
          await repository.lockProfiles(tx, input.organizationId)
          const applied = plan(await repository.listMemberProfiles(tx, input.organizationId))
          if (applied.changes.length) {
            await repository.upsertProfiles(
              tx,
              applied.changes.map(({ memberId, profile }) => ({ memberId, ...profile })),
              context.userId
            )
          }
          return applied
        })
      : plan(await repository.listMemberProfiles(db, input.organizationId))
    const skipped = result.issues.filter((issue) => issue.severity === 'skipped').length
    return {
      updated: result.changes.length,
      unchanged: result.unchanged,
      skipped,
      warnings: result.issues.length - skipped,
      issues: result.issues.slice(0, MAX_REPORTED_ISSUES),
      applied: input.apply,
    }
  },
  projectAudit: ({ result, input }) =>
    result.applied
      ? [
          {
            action: AuditAction.ORG_PEOPLE_IMPORTED,
            resourceType: AuditResourceType.ORGANIZATION,
            resourceId: input.organizationId,
            description: `Imported people data: ${result.updated} profiles updated`,
            metadata: {
              rows: input.rows.length,
              updated: result.updated,
              unchanged: result.unchanged,
              skipped: result.skipped,
              warnings: result.warnings,
            },
          },
        ]
      : [],
})
