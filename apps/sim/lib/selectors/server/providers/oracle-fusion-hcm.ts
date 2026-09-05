import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  executeOracleFusionHcmGetAbsence,
  executeOracleFusionHcmGetWorker,
  executeOracleFusionHcmGetWorkerAssignment,
  executeOracleFusionHcmListAbsences,
  executeOracleFusionHcmListAbsenceTypes,
  executeOracleFusionHcmListWorkerAssignments,
  executeOracleFusionHcmListWorkers,
} from '@/lib/internal/oracle-fusion-hcm/operations'
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
} satisfies ServerSelectorAttachmentMap<
  | 'oracle_fusion_hcm.workers'
  | 'oracle_fusion_hcm.assignments'
  | 'oracle_fusion_hcm.absences'
  | 'oracle_fusion_hcm.absenceTypes'
>
