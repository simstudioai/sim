import { isRecordLike } from '@sim/utils/object'
import {
  type OracleFusionRequest,
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import * as projectors from '@/lib/internal/oracle-fusion-learning/projectors'
import type * as Schemas from '@/lib/internal/oracle-fusion-learning/schema'
import type { LearningPage } from '@/tools/oracle_fusion_learning/types'

interface LearningInput extends OracleFusionResolvedCredential {
  personId?: string
  learningItemId?: string
  eventId?: string
  activityId?: string
  recordId?: string
  offeringRecordId?: string
  completionDetailId?: string
  profileId?: string
  criterionId?: string
  audienceId?: string
  contentId?: string
  search?: string
  effectiveDate?: string
  assignmentStatus?: string
  limit?: number
  offset?: number
  body?: Record<string, unknown>
}
interface Resource<T> {
  path: string
  id?: string
  param?: keyof LearningInput
  effectiveDate: boolean
  fields: string
  search: readonly string[]
  project: (value: unknown) => T
}
type Query = Record<string, string | number | boolean | undefined>

const selfResource = {
  path: 'learningSelfPacedItems',
  id: 'learningItemId',
  param: 'learningItemId',
  effectiveDate: true,
  fields: projectors.selfFields,
  search: ["learningItemTitle","learningItemNumber"],
  project: projectors.projectSelfPacedItem,
} satisfies Resource<ReturnType<typeof projectors.projectSelfPacedItem>>

const eventResource = {
  path: 'learningEvents',
  id: 'learningItemId',
  param: 'eventId',
  effectiveDate: true,
  fields: projectors.eventFields,
  search: ["learningItemTitle","learningItemNumber"],
  project: projectors.projectLearningEvent,
} satisfies Resource<ReturnType<typeof projectors.projectLearningEvent>>

const activityResource = {
  path: 'activities',
  id: 'activityId',
  param: 'activityId',
  effectiveDate: true,
  fields: projectors.activityFields,
  search: ["activityNumber"],
  project: projectors.projectEventActivity,
} satisfies Resource<ReturnType<typeof projectors.projectEventActivity>>

const recordResource = {
  path: 'learnerLearningRecords',
  id: 'assignmentRecordId',
  param: 'recordId',
  effectiveDate: true,
  fields: projectors.recordFields,
  search: ["learningItemTitle","learningItemNumber"],
  project: projectors.projectLearningRecord,
} satisfies Resource<ReturnType<typeof projectors.projectLearningRecord>>

const offeringResource = {
  path: 'selectedCourseOfferings',
  id: 'assignmentRecordId',
  param: 'offeringRecordId',
  effectiveDate: true,
  fields: projectors.offeringFields,
  search: ["learningItemTitle","learningItemNumber"],
  project: projectors.projectSelectedCourseOffering,
} satisfies Resource<ReturnType<typeof projectors.projectSelectedCourseOffering>>

const completionResource = {
  path: 'completionDetails',
  id: 'activityAssignmentRecordId',
  param: 'completionDetailId',
  effectiveDate: false,
  fields: projectors.completionFields,
  search: [],
  project: projectors.projectCompletionDetail,
} satisfies Resource<ReturnType<typeof projectors.projectCompletionDetail>>

const summaryResource = {
  path: 'completionSummary',
  effectiveDate: false,
  fields: projectors.summaryFields,
  search: [],
  project: projectors.projectCompletionSummary,
} satisfies Resource<ReturnType<typeof projectors.projectCompletionSummary>>

const hintsResource = {
  path: 'userActionHints',
  effectiveDate: false,
  fields: projectors.hintsFields,
  search: [],
  project: projectors.projectActionHints,
} satisfies Resource<ReturnType<typeof projectors.projectActionHints>>

const historyResource = {
  path: 'enrollmentHistory',
  effectiveDate: false,
  fields: projectors.historyFields,
  search: [],
  project: projectors.projectEnrollmentHistory,
} satisfies Resource<ReturnType<typeof projectors.projectEnrollmentHistory>>

const profileResource = {
  path: 'learningAssignmentProfiles',
  id: 'assignmentProfileId',
  param: 'profileId',
  effectiveDate: true,
  fields: projectors.profileFields,
  search: ["assignmentProfileTitle","assignmentProfileNumber"],
  project: projectors.projectAssignmentProfile,
} satisfies Resource<ReturnType<typeof projectors.projectAssignmentProfile>>

const profileRecordResource = {
  path: 'assignmentProfileRecords',
  effectiveDate: false,
  fields: projectors.profileRecordFields,
  search: [],
  project: projectors.projectAssignmentProfileRecord,
} satisfies Resource<ReturnType<typeof projectors.projectAssignmentProfileRecord>>

const criterionResource = {
  path: 'learningAssignmentProfileCriteria',
  id: 'assignmentProfileCriteriaId',
  param: 'criterionId',
  effectiveDate: true,
  fields: projectors.criterionFields,
  search: [],
  project: projectors.projectAssignmentProfileCriterion,
} satisfies Resource<ReturnType<typeof projectors.projectAssignmentProfileCriterion>>

const audienceResource = {
  path: 'learningItemAudiences',
  id: 'learnRelationId',
  param: 'audienceId',
  effectiveDate: false,
  fields: projectors.audienceFields,
  search: [],
  project: projectors.projectLearningItemAudience,
} satisfies Resource<ReturnType<typeof projectors.projectLearningItemAudience>>

const contentResource = {
  path: 'learningContentItems',
  id: 'ContentId',
  param: 'contentId',
  effectiveDate: false,
  fields: projectors.contentFields,
  search: [],
  project: projectors.projectContentItem,
} satisfies Resource<ReturnType<typeof projectors.projectContentItem>>


function invalidResponse(): never {
  throw new OracleFusionProviderError('Oracle Fusion Learning returned an invalid resource', 502)
}

async function request(input: LearningInput, spec: OracleFusionRequest, signal?: AbortSignal) {
  try {
    const credential = { instanceUrl: input.instanceUrl, accessToken: input.accessToken }
    const result = spec.method === 'DELETE'
      ? await requestOracleFusionEmpty(credential, spec, signal)
      : await requestOracleFusionJson(credential, spec, signal)
    signal?.throwIfAborted()
    return result
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      const message = error.status === 401 ? 'Oracle Fusion Learning authentication failed'
        : error.status === 403 ? 'Oracle Fusion Learning denied this request'
          : error.status === 404 ? 'Oracle Fusion Learning resource was not found'
            : error.status === 429 ? 'Oracle Fusion Learning rate limit exceeded'
              : 'Oracle Fusion Learning request failed'
      throw new OracleFusionProviderError(message, error.status)
    }
    throw error
  }
}

function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_*?]/g, '\\$&').replace(/'/g, "''")
}

function filters<T>(resource: Resource<T>, input: LearningInput): string[] {
  const predicates: string[] = []
  if (resource.path === 'learnerLearningRecords' && input.personId) predicates.push(`assignedToId=${input.personId}`)
  if (resource.path === 'learningItemAudiences' && input.learningItemId) predicates.push(`learningItemId=${input.learningItemId}`)
  return predicates
}

function assertIdentity(raw: unknown, field: string, expected: string): void {
  if (!isRecordLike(raw) || normalizeOracleFusionDecimalIdentifier(raw[field], { maxDigits: 19 }) !== expected) invalidResponse()
}

function assertScope<T>(raw: unknown, resource: Resource<T>, input: LearningInput): void {
  if (resource.path === 'learnerLearningRecords' && input.personId) assertIdentity(raw, 'assignedToId', input.personId)
  if (resource.path === 'learningItemAudiences' && input.learningItemId) assertIdentity(raw, 'learningItemId', input.learningItemId)
}

function effectiveQuery<T>(resource: Resource<T>, input: LearningInput): Query {
  return resource.effectiveDate && input.effectiveDate ? { effectiveDate: input.effectiveDate } : {}
}

async function resolvePath<T>(
  resource: Resource<T>, input: LearningInput, collection: string, signal?: AbortSignal
): Promise<string> {
  const expected = resource.param ? input[resource.param] : undefined
  if (typeof expected !== 'string' || !resource.id) throw new OracleFusionProviderError('Learning resource ID is required', 400)
  if (resource.path === 'learningContentItems') return `${collection}/${expected}`
  const q = [...filters(resource, input), `${resource.id}=${expected}`].join(';')
  const raw = await request(input, {
    address: { family: 'hcm', relativePath: collection },
    query: { ...effectiveQuery(resource, input), q, fields: resource.fields, limit: 2, offset: 0, links: 'self' },
  }, signal)
  try {
    const page = parseOracleFusionCollection(raw, (value) => value, { expectedOffset: 0, maxItems: 2 })
    if (page.items.length === 0 && !page.hasMore) throw new OracleFusionProviderError('Oracle Fusion Learning resource was not found', 404)
    if (page.items.length !== 1 || page.hasMore) invalidResponse()
    const item = page.items[0]
    assertIdentity(item, resource.id, expected)
    assertScope(item, resource, input)
    const key = extractOracleFusionOpaqueKey(item, input.instanceUrl, { family: 'hcm', relativePath: collection })
    return `${collection}/${encodeOracleFusionPathSegment(key)}`
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    invalidResponse()
  }
}

async function collectionPath(family: string, input: LearningInput, signal?: AbortSignal): Promise<string> {
  if (family === 'activity') return `${await resolvePath(eventResource, input, eventResource.path, signal)}/child/activities`
  if (['offering', 'completion', 'summary', 'hints', 'history'].includes(family)) {
    let parent = await resolvePath(recordResource, input, recordResource.path, signal)
    if (family !== 'offering' && input.offeringRecordId) {
      parent = await resolvePath(offeringResource, input, `${parent}/child/selectedCourseOfferings`, signal)
    }
    const children: Record<string, string> = { offering: 'selectedCourseOfferings', completion: 'completionDetails', summary: 'completionSummary', hints: 'userActionHints', history: 'enrollmentHistory' }
    const child = children[family]
    return `${parent}/child/${child}`
  }
  if (family === 'criterion' || family === 'profileRecord') {
    const parent = await resolvePath(profileResource, input, profileResource.path, signal)
    return `${parent}/child/${family === 'criterion' ? 'learningAssignmentProfileCriteria' : 'assignmentProfileRecords'}`
  }
  throw new Error('Unknown Learning child resource')
}

async function list<T>(resource: Resource<T>, input: LearningInput, path: string, signal?: AbortSignal): Promise<{ success: true; output: LearningPage<T> }> {
  const limit = input.limit ?? 20
  const offset = input.offset ?? 0
  const predicates = filters(resource, input)
  if (input.search && resource.search.length) {
    predicates.push(`(${resource.search.map((field) => `${field} LIKE '%${quote(input.search!)}%'`).join(' OR ')})`)
  }
  if (input.assignmentStatus) predicates.push(`assignmentStatus='${quote(input.assignmentStatus)}'`)
  if (resource.path === 'learnerLearningRecords' && input.learningItemId) predicates.push(`learningItemId=${input.learningItemId}`)
  const raw = await request(input, {
    address: { family: 'hcm', relativePath: path },
    query: { ...effectiveQuery(resource, input), fields: resource.fields, onlyData: true, limit, offset, q: predicates.length ? predicates.join(';') : undefined },
  }, signal)
  try {
    const page = parseOracleFusionCollection(raw, (item) => {
      assertScope(item, resource, input)
      return resource.project(item)
    }, { expectedOffset: offset, maxItems: limit })
    const { nextOffset, ...output } = page
    return { success: true, output: { ...output, ...(page.hasMore ? { nextOffset } : {}) } }
  } catch { invalidResponse() }
}

async function get<T>(resource: Resource<T>, input: LearningInput, collection: string, signal?: AbortSignal) {
  const path = await resolvePath(resource, input, collection, signal)
  const raw = await request(input, {
    address: { family: 'hcm', relativePath: path },
    query: { ...effectiveQuery(resource, input), fields: resource.fields, links: 'self' },
  }, signal)
  try {
    validateOracleFusionSelfLink(raw, input.instanceUrl, { family: 'hcm', relativePath: path })
    assertIdentity(raw, resource.id!, input[resource.param!] as string)
    assertScope(raw, resource, input)
    return { success: true as const, output: { item: resource.project(raw) } }
  } catch { invalidResponse() }
}

/** IDs remain strings until this final server-side serialization boundary. */
function mutationBody(input: LearningInput, resourcePath: string, method: 'POST' | 'PATCH'): Record<string, unknown> {
  const body = { ...input.body }
  if (method === 'POST') {
    if (resourcePath === 'learnerLearningRecords' || resourcePath === 'selectedCourseOfferings') body.assignedToId = input.personId
    if (resourcePath === 'learningItemAudiences') body.learningItemId = input.learningItemId
    if (resourcePath === 'learningContentItems') body.TrackingType = 'ORA_AUTO'
  }
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [
    key, /(?:Id|ID)$/.test(key) && typeof value === 'string' ? oracleFusionExactInteger(value) : value,
  ]))
}

async function mutate<T>(resource: Resource<T>, input: LearningInput, collection: string, method: 'POST' | 'PATCH', signal?: AbortSignal) {
  const path = method === 'PATCH' ? await resolvePath(resource, input, collection, signal) : collection
  const raw = await request(input, {
    address: { family: 'hcm', relativePath: path },
    method,
    mediaType: 'application/vnd.oracle.adf.resourceitem+json',
    body: mutationBody(input, resource.path, method),
  }, signal)
  try {
    if (method === 'PATCH') assertIdentity(raw, resource.id!, input[resource.param!] as string)
    assertScope(raw, resource, input)
    return { success: true as const, output: { item: resource.project(raw) } }
  } catch { invalidResponse() }
}

async function remove<T>(resource: Resource<T>, input: LearningInput, collection: string, signal?: AbortSignal) {
  const path = await resolvePath(resource, input, collection, signal)
  await request(input, { address: { family: 'hcm', relativePath: path }, method: 'DELETE' }, signal)
  return { success: true as const, output: { deleted: true as const } }
}

export async function executeListSelfPacedItems(input: Schemas.ListSelfPacedItemsInput, signal?: AbortSignal) {
  return list(selfResource, input, selfResource.path, signal)
}

export async function executeGetSelfPacedItem(input: Schemas.GetSelfPacedItemInput, signal?: AbortSignal) {
  return get(selfResource, input, selfResource.path, signal)
}

export async function executeCreateSelfPacedItem(input: Schemas.CreateSelfPacedItemInput, signal?: AbortSignal) {
  return mutate(selfResource, input, selfResource.path, 'POST', signal)
}

export async function executeUpdateSelfPacedItem(input: Schemas.UpdateSelfPacedItemInput, signal?: AbortSignal) {
  return mutate(selfResource, input, selfResource.path, 'PATCH', signal)
}

export async function executeDeleteSelfPacedItem(input: Schemas.DeleteSelfPacedItemInput, signal?: AbortSignal) {
  return remove(selfResource, input, selfResource.path, signal)
}

export async function executeListLearningEvents(input: Schemas.ListLearningEventsInput, signal?: AbortSignal) {
  return list(eventResource, input, eventResource.path, signal)
}

export async function executeGetLearningEvent(input: Schemas.GetLearningEventInput, signal?: AbortSignal) {
  return get(eventResource, input, eventResource.path, signal)
}

export async function executeCreateLearningEvent(input: Schemas.CreateLearningEventInput, signal?: AbortSignal) {
  return mutate(eventResource, input, eventResource.path, 'POST', signal)
}

export async function executeUpdateLearningEvent(input: Schemas.UpdateLearningEventInput, signal?: AbortSignal) {
  return mutate(eventResource, input, eventResource.path, 'PATCH', signal)
}

export async function executeListEventActivities(input: Schemas.ListEventActivitiesInput, signal?: AbortSignal) {
  return list(activityResource, input, await collectionPath('activity', input, signal), signal)
}

export async function executeCreateEventActivity(input: Schemas.CreateEventActivityInput, signal?: AbortSignal) {
  return mutate(activityResource, input, await collectionPath('activity', input, signal), 'POST', signal)
}

export async function executeUpdateEventActivity(input: Schemas.UpdateEventActivityInput, signal?: AbortSignal) {
  return mutate(activityResource, input, await collectionPath('activity', input, signal), 'PATCH', signal)
}

export async function executeDeleteEventActivity(input: Schemas.DeleteEventActivityInput, signal?: AbortSignal) {
  return remove(activityResource, input, await collectionPath('activity', input, signal), signal)
}

export async function executeListLearningRecords(input: Schemas.ListLearningRecordsInput, signal?: AbortSignal) {
  return list(recordResource, input, recordResource.path, signal)
}

export async function executeGetLearningRecord(input: Schemas.GetLearningRecordInput, signal?: AbortSignal) {
  return get(recordResource, input, recordResource.path, signal)
}

export async function executeCreateLearningRecord(input: Schemas.CreateLearningRecordInput, signal?: AbortSignal) {
  return mutate(recordResource, input, recordResource.path, 'POST', signal)
}

export async function executeUpdateLearningRecord(input: Schemas.UpdateLearningRecordInput, signal?: AbortSignal) {
  return mutate(recordResource, input, recordResource.path, 'PATCH', signal)
}

export async function executeListSelectedCourseOfferings(input: Schemas.ListSelectedCourseOfferingsInput, signal?: AbortSignal) {
  return list(offeringResource, input, await collectionPath('offering', input, signal), signal)
}

export async function executeSelectCourseOffering(input: Schemas.SelectCourseOfferingInput, signal?: AbortSignal) {
  return mutate(offeringResource, input, await collectionPath('offering', input, signal), 'POST', signal)
}

export async function executeUpdateSelectedCourseOffering(input: Schemas.UpdateSelectedCourseOfferingInput, signal?: AbortSignal) {
  return mutate(offeringResource, input, await collectionPath('offering', input, signal), 'PATCH', signal)
}

export async function executeListCompletionDetails(input: Schemas.ListCompletionDetailsInput, signal?: AbortSignal) {
  return list(completionResource, input, await collectionPath('completion', input, signal), signal)
}

export async function executeUpdateCompletionDetail(input: Schemas.UpdateCompletionDetailInput, signal?: AbortSignal) {
  return mutate(completionResource, input, await collectionPath('completion', input, signal), 'PATCH', signal)
}

export async function executeListCompletionSummaries(input: Schemas.ListCompletionSummariesInput, signal?: AbortSignal) {
  return list(summaryResource, input, await collectionPath('summary', input, signal), signal)
}

export async function executeListLearningRecordActionHints(input: Schemas.ListLearningRecordActionHintsInput, signal?: AbortSignal) {
  return list(hintsResource, input, await collectionPath('hints', input, signal), signal)
}

export async function executeListEnrollmentHistory(input: Schemas.ListEnrollmentHistoryInput, signal?: AbortSignal) {
  return list(historyResource, input, await collectionPath('history', input, signal), signal)
}

export async function executeListAssignmentProfiles(input: Schemas.ListAssignmentProfilesInput, signal?: AbortSignal) {
  return list(profileResource, input, profileResource.path, signal)
}

export async function executeGetAssignmentProfile(input: Schemas.GetAssignmentProfileInput, signal?: AbortSignal) {
  return get(profileResource, input, profileResource.path, signal)
}

export async function executeCreateAssignmentProfile(input: Schemas.CreateAssignmentProfileInput, signal?: AbortSignal) {
  return mutate(profileResource, input, profileResource.path, 'POST', signal)
}

export async function executeUpdateAssignmentProfile(input: Schemas.UpdateAssignmentProfileInput, signal?: AbortSignal) {
  return mutate(profileResource, input, profileResource.path, 'PATCH', signal)
}

export async function executeProcessAssignmentProfile(input: Schemas.ProcessAssignmentProfileInput, signal?: AbortSignal) {
  const path = await resolvePath(profileResource, input, profileResource.path, signal)
  const raw = await request(input, {
    address: { family: 'hcm', relativePath: `${path}/action/process` },
    method: 'POST', mediaType: 'application/vnd.oracle.adf.action+json', body: {},
  }, signal)
  if (!isRecordLike(raw) || typeof raw.result !== 'number' || !Number.isFinite(raw.result)) invalidResponse()
  return { success: true as const, output: { result: raw.result } }
}

export async function executeListAssignmentProfileRecords(input: Schemas.ListAssignmentProfileRecordsInput, signal?: AbortSignal) {
  return list(profileRecordResource, input, await collectionPath('profileRecord', input, signal), signal)
}

export async function executeListAssignmentProfileCriteria(input: Schemas.ListAssignmentProfileCriteriaInput, signal?: AbortSignal) {
  return list(criterionResource, input, await collectionPath('criterion', input, signal), signal)
}

export async function executeAddAssignmentProfileCriterion(input: Schemas.AddAssignmentProfileCriterionInput, signal?: AbortSignal) {
  return mutate(criterionResource, input, await collectionPath('criterion', input, signal), 'POST', signal)
}

export async function executeRemoveAssignmentProfileCriterion(input: Schemas.RemoveAssignmentProfileCriterionInput, signal?: AbortSignal) {
  return remove(criterionResource, input, await collectionPath('criterion', input, signal), signal)
}

export async function executeListLearningItemAudiences(input: Schemas.ListLearningItemAudiencesInput, signal?: AbortSignal) {
  return list(audienceResource, input, audienceResource.path, signal)
}

export async function executeAddLearningItemAudience(input: Schemas.AddLearningItemAudienceInput, signal?: AbortSignal) {
  return mutate(audienceResource, input, audienceResource.path, 'POST', signal)
}

export async function executeRemoveLearningItemAudience(input: Schemas.RemoveLearningItemAudienceInput, signal?: AbortSignal) {
  return remove(audienceResource, input, audienceResource.path, signal)
}

export async function executeGetContentItem(input: Schemas.GetContentItemInput, signal?: AbortSignal) {
  return get(contentResource, input, contentResource.path, signal)
}

export async function executeCreateWebLinkContent(input: Schemas.CreateWebLinkContentInput, signal?: AbortSignal) {
  return mutate(contentResource, input, contentResource.path, 'POST', signal)
}

export async function executeUpdateContentItem(input: Schemas.UpdateContentItemInput, signal?: AbortSignal) {
  return mutate(contentResource, input, contentResource.path, 'PATCH', signal)
}

export async function getEventActivityForSelector(input: OracleFusionResolvedCredential & { eventId: string; activityId: string; effectiveDate?: string }, signal?: AbortSignal) {
  return get(activityResource, input, await collectionPath('activity', input, signal), signal)
}

export async function getSelectedCourseOfferingForSelector(input: OracleFusionResolvedCredential & { personId: string; recordId: string; offeringRecordId: string; effectiveDate?: string }, signal?: AbortSignal) {
  return get(offeringResource, input, await collectionPath('offering', input, signal), signal)
}

export async function getCompletionDetailForSelector(input: OracleFusionResolvedCredential & { personId: string; recordId: string; completionDetailId: string; offeringRecordId?: string; effectiveDate?: string }, signal?: AbortSignal) {
  return get(completionResource, input, await collectionPath('completion', input, signal), signal)
}
