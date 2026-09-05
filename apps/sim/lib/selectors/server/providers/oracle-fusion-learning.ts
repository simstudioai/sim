import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-learning/operations'
import { dateSchema, decimalIdSchema } from '@/lib/internal/oracle-fusion-learning/schema'
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

function parseId(value: string | undefined): string {
  const parsed = decimalIdSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function parseOffset(cursor?: string): number {
  if (!cursor) return 0
  const offset = Number(cursor)
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(offset))
    throw new SelectorContextUnavailableError()
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
  const effectiveDate = args.context.effectiveDate
  if (effectiveDate && !dateSchema.safeParse(effectiveDate).success)
    throw new SelectorContextUnavailableError()
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
  return { instanceUrl, accessToken: bundle.accessToken, effectiveDate }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_learning'],
} as const
const integrationBlockTypes = ['oracle_fusion_learning'] as const
const destination = { kind: 'credential-bound', prepare } as const

export const oracleFusionLearningSelectorAttachments = {
  'oracle_fusion_learning.selfPacedItems': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const input = { ...prepared }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.executeGetSelfPacedItem(
            { ...input, learningItemId: id },
            args.signal
          )
          const item = result.output.item
          if (item.learningItemId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.learningItemTitle || item.learningItemNumber || id,
            meta: { number: item.learningItemNumber },
          })
        }
        const result = await operations.executeListSelfPacedItems(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.learningItemId,
            label: item.learningItemTitle || item.learningItemNumber || item.learningItemId,
            meta: { number: item.learningItemNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.events': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const input = { ...prepared }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.executeGetLearningEvent(
            { ...input, eventId: id },
            args.signal
          )
          const item = result.output.item
          if (item.learningItemId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.learningItemTitle || item.learningItemNumber || id,
            meta: { number: item.learningItemNumber },
          })
        }
        const result = await operations.executeListLearningEvents(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.learningItemId,
            label: item.learningItemTitle || item.learningItemNumber || item.learningItemId,
            meta: { number: item.learningItemNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.eventActivities': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const eventId = parseId(args.context.eventId)
        const input = { ...prepared, eventId }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.getEventActivityForSelector(
            { ...input, activityId: id },
            args.signal
          )
          const item = result.output.item
          if (item.activityId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.title || item.activityNumber || id,
            meta: { number: item.activityNumber },
          })
        }
        const result = await operations.executeListEventActivities(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.activityId,
            label: item.title || item.activityNumber || item.activityId,
            meta: { number: item.activityNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.learningRecords': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const personId = parseId(args.context.personId)
        const input = { ...prepared, personId }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.executeGetLearningRecord(
            { ...input, recordId: id },
            args.signal
          )
          const item = result.output.item
          if (item.assignmentRecordId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.learningItemTitle || item.assignmentRecordNumber || id,
            meta: { number: item.assignmentRecordNumber },
          })
        }
        const result = await operations.executeListLearningRecords(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.assignmentRecordId,
            label: item.learningItemTitle || item.assignmentRecordNumber || item.assignmentRecordId,
            meta: { number: item.assignmentRecordNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.selectedCourseOfferings': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const personId = parseId(args.context.personId)
        const recordId = parseId(args.context.recordId)
        const input = { ...prepared, personId, recordId }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.getSelectedCourseOfferingForSelector(
            { ...input, offeringRecordId: id },
            args.signal
          )
          const item = result.output.item
          if (item.assignmentRecordId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.learningItemTitle || item.assignmentRecordNumber || id,
            meta: { number: item.assignmentRecordNumber },
          })
        }
        const result = await operations.executeListSelectedCourseOfferings(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.assignmentRecordId,
            label: item.learningItemTitle || item.assignmentRecordNumber || item.assignmentRecordId,
            meta: { number: item.assignmentRecordNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.completionDetails': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const personId = parseId(args.context.personId)
        const recordId = parseId(args.context.recordId)
        const input = { ...prepared, personId, recordId }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.getCompletionDetailForSelector(
            { ...input, completionDetailId: id },
            args.signal
          )
          const item = result.output.item
          if (item.activityAssignmentRecordId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.activityTitle || item.activityNumber || id,
            meta: { number: item.activityNumber },
          })
        }
        const result = await operations.executeListCompletionDetails(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.activityAssignmentRecordId,
            label: item.activityTitle || item.activityNumber || item.activityAssignmentRecordId,
            meta: { number: item.activityNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
  'oracle_fusion_learning.assignmentProfiles': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination,
    async execute(args, prepared) {
      try {
        const input = { ...prepared }
        if (args.request.kind === 'detail') {
          const id = parseId(args.request.id)
          const result = await operations.executeGetAssignmentProfile(
            { ...input, profileId: id },
            args.signal
          )
          const item = result.output.item
          if (item.assignmentProfileId !== id) throw new SelectorOptionsUnavailableError()
          return detailSelectorResult({
            id,
            label: item.assignmentProfileTitle || item.assignmentProfileNumber || id,
            meta: { number: item.assignmentProfileNumber },
          })
        }
        const result = await operations.executeListAssignmentProfiles(
          {
            ...input,
            limit: 50,
            offset: parseOffset(args.request.cursor),
            search: args.request.search?.trim().slice(0, 200) || undefined,
          },
          args.signal
        )
        const page = result.output
        if (page.hasMore && page.nextOffset === undefined)
          throw new SelectorOptionsUnavailableError()
        return listSelectorResult(
          page.items.map((item) => ({
            id: item.assignmentProfileId,
            label:
              item.assignmentProfileTitle ||
              item.assignmentProfileNumber ||
              item.assignmentProfileId,
            meta: { number: item.assignmentProfileNumber },
          })),
          page.hasMore ? String(page.nextOffset) : undefined
        )
      } catch (error) {
        args.signal?.throwIfAborted()
        if (
          args.request.kind === 'detail' &&
          error instanceof OracleFusionProviderError &&
          error.status === 404
        )
          return detailSelectorResult(null)
        publicError(error)
      }
    },
  }),
} satisfies ServerSelectorAttachmentMap<
  | 'oracle_fusion_learning.selfPacedItems'
  | 'oracle_fusion_learning.events'
  | 'oracle_fusion_learning.eventActivities'
  | 'oracle_fusion_learning.learningRecords'
  | 'oracle_fusion_learning.selectedCourseOfferings'
  | 'oracle_fusion_learning.completionDetails'
  | 'oracle_fusion_learning.assignmentProfiles'
>
