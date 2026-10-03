import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  executeOracleFusionHcmGetAbsence,
  executeOracleFusionHcmGetElementEntry,
  executeOracleFusionHcmGetGoalPlan,
  executeOracleFusionHcmGetPayrollAssignment,
  executeOracleFusionHcmGetPayrollRelationship,
  executeOracleFusionHcmGetPerformanceDocument,
  executeOracleFusionHcmGetSalary,
  executeOracleFusionHcmGetTalentProfile,
  executeOracleFusionHcmGetWorker,
  executeOracleFusionHcmGetWorkerAssignment,
  executeOracleFusionHcmListAbsences,
  executeOracleFusionHcmListAbsenceTypes,
  executeOracleFusionHcmListElementEntries,
  executeOracleFusionHcmListGoalPlans,
  executeOracleFusionHcmListPayrollAssignments,
  executeOracleFusionHcmListPayrollDefinitions,
  executeOracleFusionHcmListPayrollElementDefinitions,
  executeOracleFusionHcmListPayrollRelationships,
  executeOracleFusionHcmListPerformanceDocuments,
  executeOracleFusionHcmListSalaries,
  executeOracleFusionHcmListSalaryBases,
  executeOracleFusionHcmListTalentProfiles,
  executeOracleFusionHcmListTimeAttributes,
  executeOracleFusionHcmListTimeAttributeValues,
  executeOracleFusionHcmListWorkerAssignments,
  executeOracleFusionHcmListWorkers,
} from '@/lib/internal/oracle-fusion-hcm/operations'
import * as schemas from '@/lib/internal/oracle-fusion-hcm/schema'
import { oracleFusionHcmDecimalIdSchema } from '@/lib/internal/oracle-fusion-hcm/schema'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

const integrationBlockTypes = ['oracle_fusion_hcm'] as const
const PAGE_SIZE = 50

interface PreparedOracleFusionHcm {
  instanceUrl: string
  accessToken: string
  personId?: string
}

function parseOffset(cursor?: string): number {
  if (!cursor) return 0
  if (!/^\d+$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}

function parseId(value: string): string {
  const parsed = oracleFusionHcmDecimalIdSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function publicSelectorError(error: unknown): never {
  if (
    error instanceof SelectorConnectionUnavailableError ||
    error instanceof SelectorContextUnavailableError ||
    error instanceof SelectorOptionsUnavailableError
  ) {
    throw error
  }
  if (error instanceof OracleFusionProviderError) {
    if (error.status === 401 || error.status === 403) {
      throw new SelectorConnectionUnavailableError(error.status)
    }
    if (error.status === 400 || error.status === 404) {
      throw new SelectorContextUnavailableError()
    }
    throw new SelectorOptionsUnavailableError(error.status === 429 ? 429 : 502)
  }
  throw new SelectorOptionsUnavailableError(502)
}

function isMissingDetail(error: unknown): boolean {
  return error instanceof OracleFusionProviderError && error.status === 404
}

async function prepareOracleFusionHcmDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedOracleFusionHcm> {
  args.signal?.throwIfAborted()
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const personId = args.context.personId ? parseId(args.context.personId) : undefined
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
  })
  args.signal?.throwIfAborted()
  const instanceUrl = bundle.instanceUrl
    ? normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
    : null
  if (!instanceUrl) throw new SelectorConnectionUnavailableError()
  return { instanceUrl, accessToken: bundle.accessToken, personId }
}

function nextCursor(hasMore: boolean, nextOffset: number | undefined): string | undefined {
  if (!hasMore) return undefined
  if (nextOffset === undefined) throw new SelectorOptionsUnavailableError()
  return String(nextOffset)
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_hcm'],
} as const

const destination = {
  kind: 'credential-bound' as const,
  prepare: prepareOracleFusionHcmDestination,
}

export const oracleFusionHcmSelectorAttachments = {
  'oracle_fusion_hcm.workers': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const requestedPersonId = parseId(args.request.id)
          const result = await executeOracleFusionHcmGetWorker(
            { ...prepared, personId: requestedPersonId },
            args.signal
          )
          const worker = result.output.worker
          if (worker.personId !== requestedPersonId) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id: requestedPersonId,
            label: worker.displayName || worker.personNumber || worker.personId,
            meta: { personNumber: worker.personNumber, workEmail: worker.workEmail },
          })
        }
        const offset = parseOffset(args.request.cursor)
        const result = await executeOracleFusionHcmListWorkers(
          { ...prepared, search: args.request.search?.slice(0, 200), limit: PAGE_SIZE, offset },
          args.signal
        )
        return listSelectorResult(
          result.output.workers.map((worker) => ({
            id: worker.personId,
            label: worker.displayName || worker.personNumber || worker.personId,
            meta: { personNumber: worker.personNumber, workEmail: worker.workEmail },
          })),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error)) {
          return detailSelectorResult(null)
        }
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.assignments': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      if (!prepared.personId) throw new SelectorContextUnavailableError()
      try {
        if (args.request.kind === 'detail') {
          const requestedAssignmentId = parseId(args.request.id)
          const result = await executeOracleFusionHcmGetWorkerAssignment(
            { ...prepared, personId: prepared.personId, assignmentId: requestedAssignmentId },
            args.signal
          )
          const assignment = result.output.assignment
          if (assignment.assignmentId !== requestedAssignmentId) {
            throw new SelectorOptionsUnavailableError()
          }
          return detailSelectorResult({
            id: requestedAssignmentId,
            label:
              assignment.assignmentName || assignment.assignmentNumber || assignment.assignmentId,
            meta: { assignmentNumber: assignment.assignmentNumber },
          })
        }
        const offset = parseOffset(args.request.cursor)
        const result = await executeOracleFusionHcmListWorkerAssignments(
          { ...prepared, personId: prepared.personId, limit: PAGE_SIZE, offset },
          args.signal
        )
        return listSelectorResult(
          result.output.assignments.map((assignment) => ({
            id: assignment.assignmentId,
            label:
              assignment.assignmentName || assignment.assignmentNumber || assignment.assignmentId,
            meta: { assignmentNumber: assignment.assignmentNumber },
          })),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error)) {
          return detailSelectorResult(null)
        }
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.absences': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      if (!prepared.personId) throw new SelectorContextUnavailableError()
      try {
        if (args.request.kind === 'detail') {
          const requestedAbsenceId = parseId(args.request.id)
          const result = await executeOracleFusionHcmGetAbsence(
            { ...prepared, absenceId: requestedAbsenceId },
            args.signal
          )
          const absence = result.output.absence
          if (absence.absenceId !== requestedAbsenceId) throw new SelectorOptionsUnavailableError()
          if (absence.personId !== prepared.personId) throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: requestedAbsenceId,
            label:
              [absence.absenceType, absence.startDate, absence.endDate]
                .filter(Boolean)
                .join(' · ') || absence.absenceId,
            meta: {
              status: absence.displayStatusMeaning || absence.displayStatus,
              startDate: absence.startDate,
              endDate: absence.endDate,
            },
          })
        }
        const offset = parseOffset(args.request.cursor)
        const result = await executeOracleFusionHcmListAbsences(
          { ...prepared, personId: prepared.personId, limit: PAGE_SIZE, offset },
          args.signal
        )
        return listSelectorResult(
          result.output.absences.map((absence) => {
            if (absence.personId !== prepared.personId) throw new SelectorContextUnavailableError()
            return {
              id: absence.absenceId,
              label:
                [absence.absenceType, absence.startDate, absence.endDate]
                  .filter(Boolean)
                  .join(' · ') || absence.absenceId,
              meta: {
                status: absence.displayStatusMeaning || absence.displayStatus,
                startDate: absence.startDate,
                endDate: absence.endDate,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error)) {
          return detailSelectorResult(null)
        }
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.absenceTypes': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      if (args.request.kind !== 'list' || !prepared.personId) {
        throw new SelectorContextUnavailableError()
      }
      try {
        const offset = parseOffset(args.request.cursor)
        const result = await executeOracleFusionHcmListAbsenceTypes(
          {
            ...prepared,
            personId: prepared.personId,
            search: args.request.search?.slice(0, 200),
            limit: PAGE_SIZE,
            offset,
          },
          args.signal
        )
        return listSelectorResult(
          result.output.absenceTypes.map((absenceType) => ({
            id: absenceType.absenceTypeId,
            label: absenceType.nameWithEmployer || absenceType.name || absenceType.absenceTypeId,
            meta: { employerName: absenceType.employerName },
          })),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.payrollRelationships': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetPayrollRelationshipBodySchema.safeParse({
            ...args.context,
            ...prepared,
            payrollRelationshipId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetPayrollRelationship(
            parsed.data,
            args.signal
          )
          const item = result.output.payrollRelationship
          if (args.context.personNumber && item.personNumber !== args.context.personNumber)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.payrollRelationshipId,
            label: item.payrollRelationshipNumber || item.payrollRelationshipId,
            meta: { personNumber: item.personNumber },
          })
        }
        const parsed = schemas.oracleFusionHcmListPayrollRelationshipsBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListPayrollRelationships(
          parsed.data,
          args.signal
        )
        return listSelectorResult(
          result.output.payrollRelationships.map((item) => {
            if (args.context.personNumber && item.personNumber !== args.context.personNumber)
              throw new SelectorContextUnavailableError()
            return {
              id: item.payrollRelationshipId,
              label: item.payrollRelationshipNumber || item.payrollRelationshipId,
              meta: { personNumber: item.personNumber },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.payrollAssignments': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (!args.context.payrollRelationshipId) throw new SelectorContextUnavailableError()
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetPayrollAssignmentBodySchema.safeParse({
            ...args.context,
            ...prepared,
            payrollAssignmentId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetPayrollAssignment(parsed.data, args.signal)
          const item = result.output.payrollAssignment

          return detailSelectorResult({
            id: item.payrollAssignmentId,
            label: item.assignmentNumber || item.payrollAssignmentId,
            meta: { assignmentId: item.assignmentId, assignmentNumber: item.assignmentNumber },
          })
        }
        const parsed = schemas.oracleFusionHcmListPayrollAssignmentsBodySchema.safeParse({
          ...args.context,
          ...prepared,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListPayrollAssignments(parsed.data, args.signal)
        return listSelectorResult(
          result.output.payrollAssignments.map((item) => {
            return {
              id: item.payrollAssignmentId,
              label: item.assignmentNumber || item.payrollAssignmentId,
              meta: { assignmentId: item.assignmentId, assignmentNumber: item.assignmentNumber },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.payrollDefinitions': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
        const parsed = schemas.oracleFusionHcmListPayrollDefinitionsBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListPayrollDefinitions(parsed.data, args.signal)
        return listSelectorResult(
          result.output.payrollDefinitions.map((item) => {
            return {
              id: item.payrollId,
              label: item.payrollName || item.payrollId,
              meta: {
                legislativeDataGroupId: item.legislativeDataGroupId,
                periodType: item.periodType,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.elementDefinitions': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
        const parsed = schemas.oracleFusionHcmListPayrollElementDefinitionsBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListPayrollElementDefinitions(
          parsed.data,
          args.signal
        )
        return listSelectorResult(
          result.output.payrollElementDefinitions.map((item) => {
            return {
              id: item.elementTypeId,
              label: item.elementName || item.elementTypeId,
              meta: {
                legislativeDataGroupId: item.legislativeDataGroupId,
                processingType: item.processingType,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.elementEntries': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetElementEntryBodySchema.safeParse({
            ...args.context,
            ...prepared,
            elementEntryId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetElementEntry(parsed.data, args.signal)
          const item = result.output.elementEntry
          if (args.context.personNumber && item.personNumber !== args.context.personNumber)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.elementEntryId,
            label:
              [item.elementName, item.effectiveStartDate].filter(Boolean).join(' · ') ||
              item.elementEntryId,
            meta: {
              elementTypeId: item.elementTypeId,
              effectiveStartDate: item.effectiveStartDate,
              effectiveEndDate: item.effectiveEndDate,
            },
          })
        }
        const parsed = schemas.oracleFusionHcmListElementEntriesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListElementEntries(parsed.data, args.signal)
        return listSelectorResult(
          result.output.elementEntries.map((item) => {
            if (args.context.personNumber && item.personNumber !== args.context.personNumber)
              throw new SelectorContextUnavailableError()
            return {
              id: item.elementEntryId,
              label:
                [item.elementName, item.effectiveStartDate].filter(Boolean).join(' · ') ||
                item.elementEntryId,
              meta: {
                elementTypeId: item.elementTypeId,
                effectiveStartDate: item.effectiveStartDate,
                effectiveEndDate: item.effectiveEndDate,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.salaries': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (!args.context.assignmentId) throw new SelectorContextUnavailableError()
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetSalaryBodySchema.safeParse({
            ...args.context,
            ...prepared,
            salaryId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetSalary(parsed.data, args.signal)
          const item = result.output.salary
          if (args.context.assignmentId && item.assignmentId !== args.context.assignmentId)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.salaryId,
            label:
              [item.salaryBasisName, item.dateFrom].filter(Boolean).join(' · ') || item.salaryId,
            meta: { assignmentId: item.assignmentId, dateFrom: item.dateFrom, dateTo: item.dateTo },
          })
        }
        const parsed = schemas.oracleFusionHcmListSalariesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListSalaries(parsed.data, args.signal)
        return listSelectorResult(
          result.output.salaries.map((item) => {
            if (args.context.assignmentId && item.assignmentId !== args.context.assignmentId)
              throw new SelectorContextUnavailableError()
            return {
              id: item.salaryId,
              label:
                [item.salaryBasisName, item.dateFrom].filter(Boolean).join(' · ') || item.salaryId,
              meta: {
                assignmentId: item.assignmentId,
                dateFrom: item.dateFrom,
                dateTo: item.dateTo,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.salaryBases': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
        const parsed = schemas.oracleFusionHcmListSalaryBasesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListSalaryBases(parsed.data, args.signal)
        return listSelectorResult(
          result.output.salaryBases.map((item) => {
            return {
              id: item.salaryBasisId,
              label: item.salaryBasisName || item.salaryBasisId,
              meta: {
                legislativeDataGroupId: item.legislativeDataGroupId,
                salaryBasisType: item.salaryBasisType,
                gradeRateId: item.gradeRateId,
              },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.goalPlans': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetGoalPlanBodySchema.safeParse({
            ...args.context,
            ...prepared,
            goalPlanId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetGoalPlan(parsed.data, args.signal)
          const item = result.output.goalPlan
          if (args.context.reviewPeriodId && item.reviewPeriodId !== args.context.reviewPeriodId)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.goalPlanId,
            label: item.goalPlanName || item.goalPlanId,
            meta: { reviewPeriodId: item.reviewPeriodId },
          })
        }
        const parsed = schemas.oracleFusionHcmListGoalPlansBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListGoalPlans(parsed.data, args.signal)
        return listSelectorResult(
          result.output.goalPlans.map((item) => {
            if (args.context.reviewPeriodId && item.reviewPeriodId !== args.context.reviewPeriodId)
              throw new SelectorContextUnavailableError()
            return {
              id: item.goalPlanId,
              label: item.goalPlanName || item.goalPlanId,
              meta: { reviewPeriodId: item.reviewPeriodId },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.performanceDocuments': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetPerformanceDocumentBodySchema.safeParse({
            ...args.context,
            ...prepared,
            evaluationId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetPerformanceDocument(
            parsed.data,
            args.signal
          )
          const item = result.output.performanceDocument
          if (args.context.personId && item.personId !== args.context.personId)
            throw new SelectorContextUnavailableError()
          if (args.context.reviewPeriodId && item.reviewPeriodId !== args.context.reviewPeriodId)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.evaluationId,
            label: item.performanceDocumentName || item.evaluationId,
            meta: { personId: item.personId, reviewPeriodId: item.reviewPeriodId },
          })
        }
        const parsed = schemas.oracleFusionHcmListPerformanceDocumentsBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListPerformanceDocuments(
          parsed.data,
          args.signal
        )
        return listSelectorResult(
          result.output.performanceDocuments.map((item) => {
            if (args.context.personId && item.personId !== args.context.personId)
              throw new SelectorContextUnavailableError()
            if (args.context.reviewPeriodId && item.reviewPeriodId !== args.context.reviewPeriodId)
              throw new SelectorContextUnavailableError()
            return {
              id: item.evaluationId,
              label: item.performanceDocumentName || item.evaluationId,
              meta: { personId: item.personId, reviewPeriodId: item.reviewPeriodId },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.talentProfiles': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const parsed = schemas.oracleFusionHcmGetTalentProfileBodySchema.safeParse({
            ...args.context,
            ...prepared,
            profileId: parseId(args.request.id),
          })
          if (!parsed.success) throw new SelectorContextUnavailableError()
          const result = await executeOracleFusionHcmGetTalentProfile(parsed.data, args.signal)
          const item = result.output.talentProfile
          if (args.context.personId && item.personId !== args.context.personId)
            throw new SelectorContextUnavailableError()
          return detailSelectorResult({
            id: item.profileId,
            label: item.displayName || item.profileCode || item.profileId,
            meta: { personId: item.personId, profileCode: item.profileCode },
          })
        }
        const parsed = schemas.oracleFusionHcmListTalentProfilesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListTalentProfiles(parsed.data, args.signal)
        return listSelectorResult(
          result.output.talentProfiles.map((item) => {
            if (args.context.personId && item.personId !== args.context.personId)
              throw new SelectorContextUnavailableError()
            return {
              id: item.profileId,
              label: item.displayName || item.profileCode || item.profileId,
              meta: { personId: item.personId, profileCode: item.profileCode },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && isMissingDetail(error))
          return detailSelectorResult(null)
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.timeAttributes': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
        const parsed = schemas.oracleFusionHcmListTimeAttributesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          search: args.request.search?.trim().slice(0, 200) || undefined,
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListTimeAttributes(parsed.data, args.signal)
        return listSelectorResult(
          result.output.timeAttributes.map((item) => {
            return {
              id: item.tmAtrbFldId,
              label: item.displayName || item.attributeName || item.tmAtrbFldId,
              meta: { attributeName: item.attributeName, tmAtrbFldUsageId: item.tmAtrbFldUsageId },
            }
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
  'oracle_fusion_hcm.payrollTimeTypes': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        if (!args.context.assignmentId) throw new SelectorContextUnavailableError()
        if (!args.context.effectiveDate) throw new SelectorContextUnavailableError()
        if (!args.context.dataSourceUsageId) throw new SelectorContextUnavailableError()
        if (!args.context.timeAttributeUsageId) throw new SelectorContextUnavailableError()
        if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
        const assignmentId = parseId(args.context.assignmentId!)
        const date = schemas.oracleFusionHcmListPayrollRelationshipsBodySchema.safeParse({
          ...prepared,
          effectiveDate: args.context.effectiveDate,
        })
        if (!date.success) throw new SelectorContextUnavailableError()
        const parsed = schemas.oracleFusionHcmListTimeAttributeValuesBodySchema.safeParse({
          ...args.context,
          ...prepared,
          bindings: [
            { name: 'pAssignmentId', value: assignmentId },
            { name: 'pEffectiveDate', value: date.data.effectiveDate },
          ],
          limit: PAGE_SIZE,
          offset: parseOffset(args.request.cursor),
        })
        if (!parsed.success) throw new SelectorContextUnavailableError()
        const result = await executeOracleFusionHcmListTimeAttributeValues(parsed.data, args.signal)
        return listSelectorResult(
          result.output.timeAttributeValues.flatMap((item) => {
            if (item.value === null) return []

            return [{ id: item.value, label: item.displayValue || item.value }]
          }),
          nextCursor(result.output.hasMore, result.output.nextOffset)
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        publicSelectorError(error)
      }
    },
  }),
} satisfies ServerSelectorAttachmentMap<
  | 'oracle_fusion_hcm.payrollRelationships'
  | 'oracle_fusion_hcm.payrollAssignments'
  | 'oracle_fusion_hcm.payrollDefinitions'
  | 'oracle_fusion_hcm.elementDefinitions'
  | 'oracle_fusion_hcm.elementEntries'
  | 'oracle_fusion_hcm.salaries'
  | 'oracle_fusion_hcm.salaryBases'
  | 'oracle_fusion_hcm.goalPlans'
  | 'oracle_fusion_hcm.performanceDocuments'
  | 'oracle_fusion_hcm.talentProfiles'
  | 'oracle_fusion_hcm.timeAttributes'
  | 'oracle_fusion_hcm.payrollTimeTypes'
  | 'oracle_fusion_hcm.workers'
  | 'oracle_fusion_hcm.assignments'
  | 'oracle_fusion_hcm.absences'
  | 'oracle_fusion_hcm.absenceTypes'
>
