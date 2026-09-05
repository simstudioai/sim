import { truncate } from '@sim/utils/string'
import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-recruiting/operations'
import { decimalIdSchema, stringIdSchema } from '@/lib/internal/oracle-fusion-recruiting/schema'
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

function parseId(value: string, textual = false): string {
  const parsed = (textual ? stringIdSchema : decimalIdSchema).safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}
function parseOffset(cursor?: string): number {
  if (!cursor) return 0
  if (!/^\d{1,16}$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}
function publicError(error: unknown): never {
  if (
    error instanceof SelectorConnectionUnavailableError ||
    error instanceof SelectorContextUnavailableError ||
    error instanceof SelectorOptionsUnavailableError
  )
    throw error
  if (error instanceof OracleFusionProviderError) {
    if (error.status === 401 || error.status === 403)
      throw new SelectorConnectionUnavailableError(error.status)
    if (error.status === 400 || error.status === 404) throw new SelectorContextUnavailableError()
    throw new SelectorOptionsUnavailableError(error.status === 429 ? 429 : 502)
  }
  throw new SelectorOptionsUnavailableError()
}
async function prepare(args: ExecuteServerSelectorArgs) {
  args.signal?.throwIfAborted()
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const candidateNumber = args.context.candidateNumber
    ? parseId(args.context.candidateNumber, true)
    : undefined
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
  })
  args.signal?.throwIfAborted()
  const instanceUrl = bundle.instanceUrl
    ? normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
    : undefined
  if (!instanceUrl) throw new SelectorConnectionUnavailableError()
  return { instanceUrl, accessToken: bundle.accessToken, candidateNumber }
}
const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_recruiting'],
} as const
const destination = { kind: 'credential-bound', prepare } as const
const integrationBlockTypes = ['oracle_fusion_recruiting'] as const

export const oracleFusionRecruitingSelectorAttachments = {
  'oracle_fusion_recruiting.candidates': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, true)
          const result = await operations.executeGetCandidate(
            { ...prepared, candidateNumber: id },
            args.signal
          )
          const item = result.output.candidate
          if (item.candidateNumber !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.displayName || id })
        }
        const result = await operations.executeListCandidates(
          {
            ...prepared,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search ? truncate(args.request.search, 200, '') : undefined,
          },
          args.signal
        )
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          output.candidates.map((item) => ({
            id: item.candidateNumber,
            label: item.displayName || item.candidateNumber,
          })),
          output.hasMore ? String(output.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_recruiting.phones': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      if (!prepared.candidateNumber) throw new SelectorContextUnavailableError()
      const parent = { candidateNumber: prepared.candidateNumber }
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, true)
          const result = await operations.executeGetCandidatePhone(
            { ...prepared, ...parent, phoneId: id },
            args.signal
          )
          const item = result.output.phone
          if (item.phoneId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.phoneNumber || id })
        }
        const result = await operations.executeListCandidatePhones(
          {
            ...prepared,
            ...parent,
            limit: 50,
            offset: parseOffset(args.request.cursor),
          },
          args.signal
        )
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          output.phones.map((item) => ({
            id: item.phoneId,
            label: item.phoneNumber || item.phoneId,
          })),
          output.hasMore ? String(output.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_recruiting.requisitions': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, false)
          const result = await operations.executeGetRequisition({ ...prepared, requisitionId: id }, args.signal)
          const item = result.output.requisition
          if (item.requisitionId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.title || id })
        }
        const result = await operations.executeListRequisitions({
          ...prepared, limit: 50, offset: parseOffset(args.request.cursor),
          search: args.request.search ? truncate(args.request.search, 200, '') : undefined,
        }, args.signal)
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined) throw new SelectorOptionsUnavailableError()
        return listSelectorResult(output.requisitions.map((item) => ({
          id: item.requisitionId, label: item.title || item.requisitionId,
        })), output.hasMore ? String(output.nextOffset) : undefined)
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_recruiting.applications': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, false)
          const result = await operations.executeGetApplication({ ...prepared, applicationId: id }, args.signal)
          const item = result.output.application
          if (item.jobApplicationId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.candidateName || id })
        }
        const result = await operations.executeListApplications({
          ...prepared, limit: 50, offset: parseOffset(args.request.cursor),
          search: args.request.search ? truncate(args.request.search, 200, '') : undefined,
        }, args.signal)
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined) throw new SelectorOptionsUnavailableError()
        return listSelectorResult(output.applications.map((item) => ({
          id: item.jobApplicationId, label: item.candidateName || item.jobApplicationId,
        })), output.hasMore ? String(output.nextOffset) : undefined)
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_recruiting.offers': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, false)
          const result = await operations.executeGetOffer({ ...prepared, offerId: id }, args.signal)
          const item = result.output.offer
          if (item.offerId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.offerName || id })
        }
        const result = await operations.executeListOffers({
          ...prepared, limit: 50, offset: parseOffset(args.request.cursor),
          search: args.request.search ? truncate(args.request.search, 200, '') : undefined,
        }, args.signal)
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined) throw new SelectorOptionsUnavailableError()
        return listSelectorResult(output.offers.map((item) => ({
          id: item.offerId, label: item.offerName || item.offerId,
        })), output.hasMore ? String(output.nextOffset) : undefined)
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_recruiting.interviewSchedules': definePreparedSelectorAttachment({
    credential, destination, integrationBlockTypes,
    async execute(args, prepared) {
      try {
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id, false)
          const result = await operations.executeGetInterviewSchedule({ ...prepared, scheduleId: id }, args.signal)
          const item = result.output.interviewSchedule
          if (item.scheduleId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({ id, label: item.scheduleTitle || id })
        }
        const result = await operations.executeListInterviewSchedules({
          ...prepared, limit: 50, offset: parseOffset(args.request.cursor),
          search: args.request.search ? truncate(args.request.search, 200, '') : undefined,
        }, args.signal)
        const output = result.output
        if (output.hasMore && output.nextOffset === undefined) throw new SelectorOptionsUnavailableError()
        return listSelectorResult(output.interviewSchedules.map((item) => ({
          id: item.scheduleId, label: item.scheduleTitle || item.scheduleId,
        })), output.hasMore ? String(output.nextOffset) : undefined)
      } catch (error) {
        args.signal?.throwIfAborted()
        if (args.request.kind === 'detail' && error instanceof OracleFusionProviderError && error.status === 404) return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
} satisfies ServerSelectorAttachmentMap<
  | 'oracle_fusion_recruiting.candidates'
  | 'oracle_fusion_recruiting.phones'
  | 'oracle_fusion_recruiting.requisitions'
  | 'oracle_fusion_recruiting.applications'
  | 'oracle_fusion_recruiting.offers'
  | 'oracle_fusion_recruiting.interviewSchedules'
>
