import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { PeopleImportBody, PeopleImportResult } from '@/lib/api/contracts/people'
import type { CursorKey } from '@/lib/api/list-query'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationMemberDirectory } from '@/lib/organizations/application/reads'
import { peopleOperations } from '@/lib/people/application/operations'
import { requirePeopleEnabled } from '@/lib/people/feature-flag'
import { matchPeopleColumns, peopleImportEmails, planPeopleImport } from '@/lib/people/import'
import { readProviderProfiles, verifyDirectoryPreview } from '@/lib/people/provider-import'
import * as repository from '@/lib/people/repository'
import type { MemberProfileFields } from '@/lib/people/validation'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'
import { readProvisionedProfiles } from '@/ee/scim/lib/repository/people-profiles'

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
    OrganizationInput & {
      search?: string
      department?: string
      departmentKey?: string
      scope?: 'roots' | 'members'
      cursorKeys?: CursorKey[]
    }
  >) => repository.listPeople(input.organizationId, input),
})

export const getPeopleChart = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.chart,
  authorizeResource: authorizeDirectory,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<
    OrganizationInput & {
      memberId?: string
      page: number
      size: number
    }
  >) {
    const branch = await db.transaction(
      (tx) =>
        repository.getChartBranch(
          tx,
          input.organizationId,
          input.memberId ? { memberId: input.memberId } : { userId: context.userId },
          input.page,
          input.size
        ),
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
    if (!branch) throw new OrchestrationError('not_found', 'Person not found')
    return branch
  },
})

/** The departments people belong to, with head counts, for filtering the People page. */
export const listDepartments = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.listDepartments,
  authorizeResource: authorizeDirectory,
  execute: ({
    input,
  }: OrganizationUseCaseContext<OrganizationInput & { search?: string; offset?: number }>) =>
    repository.listDepartments(input.organizationId, input),
})

/**
 * One person with the managers above them and the people who report to them, read from one
 * snapshot so a reporting-line edit made meanwhile can't leave the three disagreeing.
 */
export const getPerson = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.get,
  authorizeResource: authorizeDirectory,
  async execute({ input }: OrganizationUseCaseContext<PersonInput>) {
    const branch = await db.transaction(
      (tx) =>
        repository.getChartBranch(tx, input.organizationId, { memberId: input.memberId }, 1, 50),
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
    if (!branch) throw new OrchestrationError('not_found', 'Person not found')
    return {
      person: branch.person,
      chain: branch.chain,
      reports: branch.reports,
      totalReports: branch.totalReports,
    }
  },
})

/**
 * Replaces one member's profile. A new manager must be another active member of the same
 * organization who doesn't already report, directly or not, to this person. The stored manager,
 * sent back unchanged, is kept even while suspended, as an import that leaves it out keeps it.
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
      const current = await repository.getPerson(tx, organizationId, memberId)
      if (!current) throw new OrchestrationError('not_found', 'Person not found')
      if (current.directorySource) {
        throw new OrchestrationError(
          'conflict',
          'This profile is managed by your directory. Update it at the source.'
        )
      }
      if (managerMemberId && managerMemberId !== current.managerMemberId) {
        const active = await repository.findActiveMembers(tx, organizationId, [managerMemberId])
        if (!active.has(managerMemberId)) {
          throw new OrchestrationError(
            'validation',
            'The manager must be a member of this organization'
          )
        }
        if (await repository.isInReportingChain(tx, memberId, managerMemberId)) {
          throw new OrchestrationError('validation', 'That manager reports to this person')
        }
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
 * Imports people data from a spreadsheet, a provider, or the active provisioning connection. A preview
 * (`apply: false`) reports what would change and writes nothing; applying re-plans under the
 * profile lock against current data, so fields the source leaves out keep any change made since the
 * preview, and reporting loops are checked against current managers.
 */
export const importPeople = defineAuthorizedOrganizationUseCase({
  operation: peopleOperations.import,
  authorizeResource: authorizeAdministration,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<
    OrganizationInput & PeopleImportBody
  >): Promise<PeopleImportResult> {
    const directory = 'source' in input
    const sourceRows = !directory
      ? {
          sourceId: null,
          headers: input.headers,
          rows: input.rows.map((cells) =>
            Object.fromEntries(input.headers.map((header, index) => [header, cells[index] ?? '']))
          ),
        }
      : input.source === 'directory'
        ? null
        : await readProviderProfiles(input)
    const result = await db.transaction(
      async (tx) => {
        if (!sourceRows && !(await isScimEntitledForOrganization(input.organizationId, tx))) {
          throw new OrchestrationError(
            'forbidden',
            'Directory provisioning is unavailable for this organization'
          )
        }
        if (input.apply) await repository.lockProfiles(tx, input.organizationId)
        const imported =
          sourceRows ?? (await readProvisionedProfiles(tx, input.organizationId, input.apply))
        const previewDigest =
          directory && imported.sourceId !== null
            ? verifyDirectoryPreview(input, imported.sourceId, imported.rows)
            : undefined
        const matched = matchPeopleColumns(imported.headers)
        if (!matched.ok) throw new OrchestrationError('validation', matched.message)
        const { emails, managerEmails } = peopleImportEmails(matched.columns, imported.rows)
        const { members, managerLinks } = await repository.listMemberProfiles(
          tx,
          input.organizationId,
          emails,
          managerEmails
        )
        const plan = planPeopleImport({
          columns: matched.columns,
          rows: imported.rows,
          members,
          managerLinks,
          directory,
        })
        if (input.apply && plan.changes.length) {
          await repository.upsertProfiles(
            tx,
            plan.changes.map(({ memberId, profile }) => ({ memberId, ...profile })),
            context.userId
          )
        }
        return { ...plan, previewDigest }
      },
      input.apply ? undefined : { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
    const skipped = result.issues.filter((issue) => issue.severity === 'skipped').length
    return {
      updated: result.changes.length,
      unchanged: result.unchanged,
      skipped,
      warnings: result.issues.length - skipped,
      issues: result.issues.slice(0, MAX_REPORTED_ISSUES),
      applied: input.apply,
      ...(!input.apply && result.previewDigest ? { previewDigest: result.previewDigest } : {}),
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
              source: 'source' in input ? input.source : 'spreadsheet',
              rows:
                'rows' in input
                  ? input.rows.length
                  : result.updated + result.skipped + result.unchanged,
              updated: result.updated,
              unchanged: result.unchanged,
              skipped: result.skipped,
              warnings: result.warnings,
            },
          },
        ]
      : [],
})
