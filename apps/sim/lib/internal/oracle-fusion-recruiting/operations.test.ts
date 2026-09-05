/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import * as operations from '@/lib/internal/oracle-fusion-recruiting/operations'

const mocks = vi.hoisted(() => ({ json: vi.fn(), empty: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
  requestOracleFusionEmpty: mocks.empty,
}))
const auth = { instanceUrl: 'https://example.fa.ocs.oraclecloud.com', accessToken: 'test-token' }
const root = `${auth.instanceUrl}/hcmRestApi/resources/11.13.18.05/`
function item(path: string, fields: Record<string, unknown>) {
  return { ...fields, links: [{ rel: 'self', href: `${root}${path}/opaque-key` }] }
}
function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, count: items.length, limit: 20, offset: 0, hasMore: false, ...extra }
}
function candidate() { return item('recruitingCandidates', { CandidateNumber: '1' }) }
function requisition() { return item('recruitingJobRequisitions', { RequisitionId: '1' }) }

describe('Recruiting provider operations', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('lists candidate records through recruitingCandidates', async () => {
    mocks.json.mockResolvedValueOnce(page([{ CandidateNumber: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidates({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.candidates[0]).toMatchObject({ candidateNumber: '1' })
    expect(result.output.candidates[0]).not.toHaveProperty('secretField')
  })
  it('lists phone records through candidatePhones', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()]))
    mocks.json.mockResolvedValueOnce(page([{ PhoneId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidatePhones({ ...auth, ...{"candidateNumber": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/candidatePhones' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.phones[0]).toMatchObject({ phoneId: '1' })
    expect(result.output.phones[0]).not.toHaveProperty('secretField')
  })
  it('lists education records through education', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()]))
    mocks.json.mockResolvedValueOnce(page([{ EducationId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidateEducation({ ...auth, ...{"candidateNumber": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/education' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.education[0]).toMatchObject({ educationId: '1' })
    expect(result.output.education[0]).not.toHaveProperty('secretField')
  })
  it('lists experience records through experience', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()]))
    mocks.json.mockResolvedValueOnce(page([{ PreviousEmploymentId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidateExperience({ ...auth, ...{"candidateNumber": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/experience' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.experience[0]).toMatchObject({ previousEmploymentId: '1' })
    expect(result.output.experience[0]).not.toHaveProperty('secretField')
  })
  it('lists skill records through skills', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()]))
    mocks.json.mockResolvedValueOnce(page([{ SkillId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidateSkills({ ...auth, ...{"candidateNumber": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/skills' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.skills[0]).toMatchObject({ skillId: '1' })
    expect(result.output.skills[0]).not.toHaveProperty('secretField')
  })
  it('lists attachment records through attachments', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()]))
    mocks.json.mockResolvedValueOnce(page([{ AttachedDocumentId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListCandidateAttachments({ ...auth, ...{"candidateNumber": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/attachments' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.attachments[0]).toMatchObject({ attachedDocumentId: '1' })
    expect(result.output.attachments[0]).not.toHaveProperty('secretField')
  })
  it('lists requisition records through recruitingJobRequisitions', async () => {
    mocks.json.mockResolvedValueOnce(page([{ RequisitionId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListRequisitions({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingJobRequisitions' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.requisitions[0]).toMatchObject({ requisitionId: '1' })
    expect(result.output.requisitions[0]).not.toHaveProperty('secretField')
  })
  it('lists posting records through publishedJobs', async () => {
    mocks.json.mockResolvedValueOnce(page([requisition()]))
    mocks.json.mockResolvedValueOnce(page([{ PublishedJobId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListRequisitionPostings({ ...auth, ...{"requisitionId": "1"} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingJobRequisitions/opaque-key/child/publishedJobs' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.postings[0]).toMatchObject({ publishedJobId: '1' })
    expect(result.output.postings[0]).not.toHaveProperty('secretField')
  })
  it('lists application records through recruitingJobApplications', async () => {
    mocks.json.mockResolvedValueOnce(page([{ JobApplicationId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListApplications({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingJobApplications' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.applications[0]).toMatchObject({ jobApplicationId: '1' })
    expect(result.output.applications[0]).not.toHaveProperty('secretField')
  })
  it('lists offer records through recruitingJobOffers', async () => {
    mocks.json.mockResolvedValueOnce(page([{ OfferId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListOffers({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingJobOffers' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.offers[0]).toMatchObject({ offerId: '1' })
    expect(result.output.offers[0]).not.toHaveProperty('secretField')
  })
  it('lists interview_schedule records through recruitingInterviewSchedulesLOV', async () => {
    mocks.json.mockResolvedValueOnce(page([{ ScheduleId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListInterviewSchedules({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingInterviewSchedulesLOV' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.interviewSchedules[0]).toMatchObject({ scheduleId: '1' })
    expect(result.output.interviewSchedules[0]).not.toHaveProperty('secretField')
  })
  it('lists requisition_template records through recruitingJobRequisitionTemplatesLOV', async () => {
    mocks.json.mockResolvedValueOnce(page([{ RequisitionId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListRequisitionTemplates({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingJobRequisitionTemplatesLOV' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.requisitionTemplates[0]).toMatchObject({ requisitionId: '1' })
    expect(result.output.requisitionTemplates[0]).not.toHaveProperty('secretField')
  })
  it('lists representative records through recruitingRepresentativesLOV', async () => {
    mocks.json.mockResolvedValueOnce(page([{ PersonId: '1', secretField: 'not-output' }]))
    const result = await operations.executeListRecruitingRepresentatives({ ...auth, ...{} })
    expect(mocks.json).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ address: { family: 'hcm', relativePath: 'recruitingRepresentativesLOV' }, query: expect.objectContaining({ limit: 20, offset: 0, onlyData: true }) }), undefined)
    expect(result.output.representatives[0]).toMatchObject({ personId: '1' })
    expect(result.output.representatives[0]).not.toHaveProperty('secretField')
  })

  it('preserves zero years of candidate skill experience', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()])).mockResolvedValueOnce(page([{ SkillId: '1', YearsOfExperience: 0 }]))
    const result = await operations.executeListCandidateSkills({ ...auth, candidateNumber: '1' })
    expect(result.output.skills[0].yearsOfExperience).toBe('0')
  })
  it('preserves bounded pagination even when the estimated total is smaller', async () => {
    mocks.json.mockResolvedValue(page([{ CandidateNumber: '1' }], { hasMore: true, offset: 20, totalResults: 0 }))
    const result = await operations.executeListCandidates({ ...auth, offset: 20 })
    expect(result.output).toMatchObject({ count: 1, nextOffset: 21, hasMore: true, totalResults: 0 })
    expect(mocks.json).toHaveBeenCalledOnce()
  })
  it('rejects oversized pages instead of returning unbounded results', async () => {
    mocks.json.mockResolvedValue(page([{ CandidateNumber: '1' }, { CandidateNumber: '2' }]))
    await expect(operations.executeListCandidates({ ...auth, limit: 1 })).rejects.toMatchObject({ status: 502 })
  })
  it('accepts an empty terminal page', async () => {
    mocks.json.mockResolvedValue(page([]))
    expect((await operations.executeListCandidates(auth)).output.candidates).toEqual([])
  })
  it.each([
    page([]),
    page([candidate(), candidate()]),
    page([item('recruitingCandidates', { CandidateNumber: '2' })]),
    page([{ CandidateNumber: '1', links: [{ rel: 'self', href: 'https://other.example/candidate' }] }]),
  ])('rejects missing, ambiguous, mismatched, or foreign candidate lookups', async (raw) => {
    mocks.json.mockResolvedValue(raw)
    await expect(operations.executeDeleteCandidate({ ...auth, candidateNumber: '1' })).rejects.toBeInstanceOf(OracleFusionProviderError)
    expect(mocks.empty).not.toHaveBeenCalled()
  })
  it('gets a candidate using its validated opaque link', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()])).mockResolvedValueOnce(candidate())
    const result = await operations.executeGetCandidate({ ...auth, candidateNumber: '1' })
    expect(result.output.candidate.candidateNumber).toBe('1')
    expect(mocks.json.mock.calls[1][1].address.relativePath).toBe('recruitingCandidates/opaque-key')
  })
  it('finds an offer by exact primary key without treating its ID as a path key', async () => {
    mocks.json.mockResolvedValue(page([item('recruitingJobOffers', { OfferId: '9007199254740993' })]))
    const result = await operations.executeGetOffer({ ...auth, offerId: '9007199254740993' })
    expect(result.output.offer.offerId).toBe('9007199254740993')
    expect(mocks.json.mock.calls[0][1].query.finder).toBe('PrimaryKey;OfferId=9007199254740993')
    expect(mocks.json).toHaveBeenCalledOnce()
  })
  it('preserves null and omits undefined candidate updates', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()])).mockResolvedValueOnce(candidate())
    await operations.executeUpdateCandidate({ ...auth, candidateNumber: '1', body: { FirstName: 'Taylor', Email: null, LastName: undefined } })
    expect(mocks.json.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: { FirstName: 'Taylor', Email: null } })
    expect(mocks.json.mock.calls[1][1].body).not.toHaveProperty('LastName')
  })
  it('serializes requisition IDs as exact numeric JSON tokens', async () => {
    mocks.json.mockResolvedValue(requisition())
    await operations.executeCreateRequisition({ ...auth, body: {"Title": "Engineer", "RecruitingType": "ORA_PROFESSIONAL", "HiringManagerId": "9007199254740993", "RecruiterId": "2", "PrimaryLocationId": "3", "PhaseId": "1", "StateId": "21", "UnlimitedOpenings": "N", "NumberOfOpenings": 1} })
    const body = mocks.json.mock.calls[0][1].body
    expect(serializeOracleFusionJsonBody(body)).toContain('"HiringManagerId":9007199254740993')
    expect(mocks.json).toHaveBeenCalledOnce()
  })
  it('deletes a phone only under the resolved candidate and phone keys', async () => {
    mocks.json.mockResolvedValueOnce(page([candidate()])).mockResolvedValueOnce(page([
      item('recruitingCandidates/opaque-key/child/candidatePhones', { PhoneId: '2' }),
    ]))
    mocks.empty.mockResolvedValue(undefined)
    const result = await operations.executeDeleteCandidatePhone({ ...auth, candidateNumber: '1', phoneId: '2' })
    expect(result.output).toEqual({ deleted: true })
    expect(mocks.empty).toHaveBeenCalledWith(expect.anything(), {
      address: { family: 'hcm', relativePath: 'recruitingCandidates/opaque-key/child/candidatePhones/opaque-key' }, method: 'DELETE',
    }, undefined)
  })
  it('does not repeat failed writes', async () => {
    mocks.json.mockRejectedValue(new OracleFusionProviderError('Rate limited', 429))
    await expect(operations.executeCreateCandidate({ ...auth, body: { FirstName: 'Taylor' } })).rejects.toMatchObject({ status: 429 })
    expect(mocks.json).toHaveBeenCalledOnce()
  })
  it('forwards cancellation and stops before a second request', async () => {
    const controller = new AbortController()
    mocks.json.mockImplementation(async () => { controller.abort(); return page([candidate()]) })
    await expect(operations.executeGetCandidate({ ...auth, candidateNumber: '1' }, controller.signal)).rejects.toThrow()
    expect(mocks.json).toHaveBeenCalledOnce()
    expect(mocks.json.mock.calls[0][2]).toBe(controller.signal)
  })
})
