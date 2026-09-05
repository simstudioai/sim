/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import * as operations from '@/lib/internal/oracle-fusion-learning/operations'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))

const auth = { instanceUrl: 'https://acme.fa.ocs.oraclecloud.com', accessToken: 'test-access-token' }
const root = auth.instanceUrl + '/hcmRestApi/resources/11.13.18.05/'
function linked(path: string, fields: Record<string, unknown>) {
  return { ...fields, links: [{ rel: 'self', href: root + path }] }
}
function page(items: unknown[], extra = {}) {
  return { items, count: items.length, hasMore: false, limit: 20, offset: 0, ...extra }
}
function recordLookup() {
  mocks.json.mockResolvedValueOnce(page([linked('learnerLearningRecords/record-key', { assignmentRecordId: '2', assignedToId: '1' })]))
}

describe('Learning operations through the Fusion client', () => {
  beforeEach(() => vi.resetAllMocks())

  it('requests one projected page and advances by actual count on short pages', async () => {
    mocks.json.mockResolvedValue(page([{ learningItemId: '9007199254740993', learningItemDraftExists: 'Y', learningItemTitle: null }], { offset: 7, limit: 20, hasMore: true }))
    const result = await operations.executeListSelfPacedItems({ ...auth, offset: 7, search: "50% O'Brien_*?" })
    expect(result.output).toMatchObject({ count: 1, hasMore: true, offset: 7, nextOffset: 8 })
    expect(result.output.items[0]).toMatchObject({ learningItemId: '9007199254740993', learningItemDraftExists: 'Y', learningItemTitle: null })
    expect(mocks.json).toHaveBeenCalledTimes(1)
    const query = mocks.json.mock.calls[0][1].query
    expect(query).toMatchObject({ limit: 20, offset: 7, onlyData: true })
    expect(query.q).toContain("O''Brien")
    expect(query.q).toContain('50\\%')
    expect(query.fields).not.toContain('UploadAuthToken')
  })

  it('rejects malformed collections and avoids a next offset for final pages', async () => {
    mocks.json.mockResolvedValueOnce({ items: [], count: 0, hasMore: true, offset: 0, limit: 20 })
    await expect(operations.executeListLearningEvents(auth)).rejects.toMatchObject({ status: 502 })
    mocks.json.mockResolvedValueOnce(page([]))
    expect((await operations.executeListLearningEvents(auth)).output).not.toHaveProperty('nextOffset')
  })

  it('resolves exact IDs with bounded lookups and validated opaque self-links', async () => {
    const item = linked('learningSelfPacedItems/opaque-key', { learningItemId: '9007199254740993' })
    mocks.json.mockResolvedValueOnce(page([item])).mockResolvedValueOnce(item)
    await operations.executeGetSelfPacedItem({ ...auth, learningItemId: '9007199254740993', effectiveDate: '2026-09-05' })
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({ q: 'learningItemId=9007199254740993', limit: 2, offset: 0, effectiveDate: '2026-09-05', links: 'self' })
    expect(mocks.json.mock.calls[1][1].address.relativePath).toBe('learningSelfPacedItems/opaque-key')
  })

  it.each([
    [page([]), 404],
    [page([{ learningItemId: '3' }, { learningItemId: '3' }]), 502],
    [page([linked('learningEvents/wrong-parent', { learningItemId: '3' })]), 502],
    [page([linked('learningSelfPacedItems/key', { learningItemId: '4' })]), 502],
  ])('rejects missing, ambiguous, and mismatched resources before mutation', async (response, status) => {
    mocks.json.mockResolvedValue(response)
    await expect(operations.executeDeleteSelfPacedItem({ ...auth, learningItemId: '3' })).rejects.toMatchObject({ status })
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it('binds learner lookups to the supplied person and rejects wrong-person records', async () => {
    mocks.json.mockResolvedValue(page([linked('learnerLearningRecords/key', { assignmentRecordId: '2', assignedToId: '99' })]))
    await expect(operations.executeGetLearningRecord({ ...auth, personId: '1', recordId: '2' })).rejects.toMatchObject({ status: 502 })
    expect(mocks.json.mock.calls[0][1].query.q).toBe('assignedToId=1;assignmentRecordId=2')
  })

  it('creates enrollments with exact numeric wire IDs and reports the returned pending state', async () => {
    mocks.json.mockResolvedValue({ assignmentRecordId: '3', assignedToId: '9007199254740993', assignmentStatus: 'ORA_ASSN_REC_PENDING' })
    const result = await operations.executeCreateLearningRecord({ ...auth, personId: '9007199254740993', body: { learningItemId: '9007199254740995' } })
    const request = mocks.json.mock.calls[0][1]
    expect(request).toMatchObject({ method: 'POST', address: { family: 'hcm', relativePath: 'learnerLearningRecords' }, mediaType: 'application/vnd.oracle.adf.resourceitem+json' })
    expect(serializeOracleFusionJsonBody(request.body)).toBe('{"learningItemId":9007199254740995,"assignedToId":9007199254740993}')
    expect(result.output.item.assignmentStatus).toBe('ORA_ASSN_REC_PENDING')
  })

  it('PATCHes assignment completion without injecting unrelated defaults', async () => {
    recordLookup()
    mocks.json.mockResolvedValueOnce({ assignmentRecordId: '2', assignedToId: '1', assignmentStatus: 'ORA_ASSN_REC_COMPLETE' })
    const body = { assignmentStatus: 'ORA_ASSN_REC_COMPLETE', completedDate: null }
    await operations.executeUpdateLearningRecord({ ...auth, personId: '1', recordId: '2', body })
    expect(mocks.json.mock.calls[1][1]).toEqual({
      address: { family: 'hcm', relativePath: 'learnerLearningRecords/record-key' },
      method: 'PATCH', mediaType: 'application/vnd.oracle.adf.resourceitem+json', body,
    })
  })

  it('targets root completion details for updates and never sends effectiveDate to that child', async () => {
    recordLookup()
    const detail = linked('learnerLearningRecords/record-key/child/completionDetails/detail-key', { activityAssignmentRecordId: '3' })
    mocks.json.mockResolvedValueOnce(page([detail])).mockResolvedValueOnce({ activityAssignmentRecordId: '3', activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED' })
    await operations.executeUpdateCompletionDetail({ ...auth, personId: '1', recordId: '2', completionDetailId: '3', body: { activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED' } })
    expect(mocks.json.mock.calls[1][1].query).not.toHaveProperty('effectiveDate')
    expect(mocks.json.mock.calls[2][1]).toMatchObject({ method: 'PATCH', address: { relativePath: 'learnerLearningRecords/record-key/child/completionDetails/detail-key' }, body: { activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED' } })
  })

  it('reads completion evidence nested under the selected offering without claiming a catalog', async () => {
    recordLookup()
    mocks.json.mockResolvedValueOnce(page([linked('learnerLearningRecords/record-key/child/selectedCourseOfferings/offering-key', { assignmentRecordId: '4' })]))
    mocks.json.mockResolvedValueOnce(page([{ completionProgress: 2, completionRequirement: 4 }]))
    const result = await operations.executeListCompletionSummaries({ ...auth, personId: '1', recordId: '2', offeringRecordId: '4', effectiveDate: '2026-09-05' })
    expect(mocks.json.mock.calls[2][1].address.relativePath).toBe('learnerLearningRecords/record-key/child/selectedCourseOfferings/offering-key/child/completionSummary')
    expect(mocks.json.mock.calls[2][1].query).not.toHaveProperty('effectiveDate')
    expect(result.output.items[0].completionProgress).toBe(2)
  })

  it('processes profiles using the ADF action contract and preserves the numeric result', async () => {
    mocks.json.mockResolvedValueOnce(page([linked('learningAssignmentProfiles/profile-key', { assignmentProfileId: '5' })])).mockResolvedValueOnce({ result: 123 })
    expect(await operations.executeProcessAssignmentProfile({ ...auth, profileId: '5' })).toEqual({ success: true, output: { result: 123 } })
    expect(mocks.json.mock.calls[1][1]).toEqual({
      address: { family: 'hcm', relativePath: 'learningAssignmentProfiles/profile-key/action/process' },
      method: 'POST', mediaType: 'application/vnd.oracle.adf.action+json', body: {},
    })
  })

  it('uses bodyless deletion acknowledgements and does not manufacture Oracle fields', async () => {
    mocks.json.mockResolvedValue(page([linked('learningSelfPacedItems/draft-key', { learningItemId: '6' })]))
    mocks.empty.mockResolvedValue(undefined)
    expect(await operations.executeDeleteSelfPacedItem({ ...auth, learningItemId: '6' })).toEqual({ success: true, output: { deleted: true } })
    expect(mocks.empty.mock.calls[0][1]).toEqual({ address: { family: 'hcm', relativePath: 'learningSelfPacedItems/draft-key' }, method: 'DELETE' })
  })

  it('creates URL content and excludes upload credentials from returned metadata', async () => {
    mocks.json.mockResolvedValue({ ContentId: '7', Title: 'Web course', TrackingType: 'ORA_AUTO', UploadAuthToken: 'secret', UploadLocation: 'https://upload.example.com' })
    const result = await operations.executeCreateWebLinkContent({ ...auth, body: { Title: 'Web course', URL: 'https://example.com/course' } })
    expect(mocks.json.mock.calls[0][1].body).toEqual({ Title: 'Web course', URL: 'https://example.com/course', TrackingType: 'ORA_AUTO' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result.output.item).not.toHaveProperty('UploadLocation')
  })

  it('creates event activities under their validated event parent', async () => {
    mocks.json.mockResolvedValueOnce(page([linked('learningEvents/event-key', { learningItemId: '8' })]))
    mocks.json.mockResolvedValueOnce({ activityId: '9', activityNumber: 'ACT-1', status: 'TEST_STATUS' })
    const body = { activityNumber: 'ACT-1', status: 'TEST_STATUS', startDate: '2026-09-05T10:00:00', timezone: 'America/Los_Angeles' }
    await operations.executeCreateEventActivity({ ...auth, eventId: '8', body })
    expect(mocks.json.mock.calls[1][1]).toMatchObject({
      address: { relativePath: 'learningEvents/event-key/child/activities' }, method: 'POST', body,
    })
  })

  it('selects an offering beneath the course assignment with the person bound by context', async () => {
    recordLookup()
    mocks.json.mockResolvedValueOnce({ assignmentRecordId: '4', learningItemId: '5' })
    await operations.executeSelectCourseOffering({ ...auth, personId: '1', recordId: '2', body: { learningItemId: '5' } })
    const request = mocks.json.mock.calls[1][1]
    expect(request.address.relativePath).toBe('learnerLearningRecords/record-key/child/selectedCourseOfferings')
    expect(request.method).toBe('POST')
    expect(serializeOracleFusionJsonBody(request.body)).toBe('{"learningItemId":5,"assignedToId":1}')
  })

  it('adds profile criteria using the documented child name and exact source ID', async () => {
    mocks.json.mockResolvedValueOnce(page([linked('learningAssignmentProfiles/profile-key', { assignmentProfileId: '5' })]))
    mocks.json.mockResolvedValueOnce({ assignmentProfileCriteriaId: '6' })
    await operations.executeAddAssignmentProfileCriterion({ ...auth, profileId: '5', body: { assignmentProfileCriteriaTypeId: '9007199254740993' } })
    expect(mocks.json.mock.calls[1][1].address.relativePath).toBe('learningAssignmentProfiles/profile-key/child/learningAssignmentProfileCriteria')
    expect(serializeOracleFusionJsonBody(mocks.json.mock.calls[1][1].body)).toBe('{"assignmentProfileCriteriaTypeId":9007199254740993}')
  })

  it('will not delete an audience returned for a different learning item', async () => {
    mocks.json.mockResolvedValueOnce(page([linked('learningItemAudiences/audience-key', { learnRelationId: '8', learningItemId: '99' })]))
    await expect(operations.executeRemoveLearningItemAudience({ ...auth, learningItemId: '7', audienceId: '8' })).rejects.toMatchObject({ status: 502 })
    expect(mocks.empty).not.toHaveBeenCalled()
  })

  it('does not retry uncertain mutations and returns fixed provider errors', async () => {
    mocks.json.mockRejectedValue(new OracleFusionProviderError('upstream-secret', 504))
    await expect(operations.executeCreateWebLinkContent({ ...auth, body: { Title: 'Web course', URL: 'https://example.com' } })).rejects.toEqual(new OracleFusionProviderError('Oracle Fusion Learning request failed', 504))
    expect(mocks.json).toHaveBeenCalledTimes(1)
  })
})
