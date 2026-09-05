/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionRecruitingTool } from '@/lib/internal/oracle-fusion-recruiting/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  list_candidates: vi.fn(),
  get_candidate: vi.fn(),
  create_candidate: vi.fn(),
  update_candidate: vi.fn(),
  delete_candidate: vi.fn(),
  list_candidate_phones: vi.fn(),
  get_candidate_phone: vi.fn(),
  create_candidate_phone: vi.fn(),
  update_candidate_phone: vi.fn(),
  delete_candidate_phone: vi.fn(),
  list_candidate_education: vi.fn(),
  list_candidate_experience: vi.fn(),
  list_candidate_skills: vi.fn(),
  list_candidate_attachments: vi.fn(),
  list_requisitions: vi.fn(),
  get_requisition: vi.fn(),
  create_requisition: vi.fn(),
  update_requisition: vi.fn(),
  delete_requisition: vi.fn(),
  list_requisition_postings: vi.fn(),
  list_applications: vi.fn(),
  get_application: vi.fn(),
  list_offers: vi.fn(),
  get_offer: vi.fn(),
  list_interview_schedules: vi.fn(),
  get_interview_schedule: vi.fn(),
  list_requisition_templates: vi.fn(),
  list_recruiting_representatives: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-fusion-recruiting/operations', () => ({
  executeListCandidates: mocks.list_candidates,
  executeGetCandidate: mocks.get_candidate,
  executeCreateCandidate: mocks.create_candidate,
  executeUpdateCandidate: mocks.update_candidate,
  executeDeleteCandidate: mocks.delete_candidate,
  executeListCandidatePhones: mocks.list_candidate_phones,
  executeGetCandidatePhone: mocks.get_candidate_phone,
  executeCreateCandidatePhone: mocks.create_candidate_phone,
  executeUpdateCandidatePhone: mocks.update_candidate_phone,
  executeDeleteCandidatePhone: mocks.delete_candidate_phone,
  executeListCandidateEducation: mocks.list_candidate_education,
  executeListCandidateExperience: mocks.list_candidate_experience,
  executeListCandidateSkills: mocks.list_candidate_skills,
  executeListCandidateAttachments: mocks.list_candidate_attachments,
  executeListRequisitions: mocks.list_requisitions,
  executeGetRequisition: mocks.get_requisition,
  executeCreateRequisition: mocks.create_requisition,
  executeUpdateRequisition: mocks.update_requisition,
  executeDeleteRequisition: mocks.delete_requisition,
  executeListRequisitionPostings: mocks.list_requisition_postings,
  executeListApplications: mocks.list_applications,
  executeGetApplication: mocks.get_application,
  executeListOffers: mocks.list_offers,
  executeGetOffer: mocks.get_offer,
  executeListInterviewSchedules: mocks.list_interview_schedules,
  executeGetInterviewSchedule: mocks.get_interview_schedule,
  executeListRequisitionTemplates: mocks.list_requisition_templates,
  executeListRecruitingRepresentatives: mocks.list_recruiting_representatives,
}))

const auth = { instanceUrl: 'https://example.fa.ocs.oraclecloud.com', accessToken: 'test-token' }
function invoke(overrides: Partial<InternalToolOperationCall> = {}) {
  return executeOracleFusionRecruitingTool({
    toolId: 'oracle_fusion_recruiting_list_candidates',
    input: auth,
    headers: new Headers(),
    requestId: 'test-request',
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    ...overrides,
  })
}
describe('Recruiting dispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ success: true, output: {} })
  })
  it.each([
    ['list_candidates', mocks.list_candidates, {}],
    ['get_candidate', mocks.get_candidate, { candidateNumber: '1' }],
    ['create_candidate', mocks.create_candidate, { body: { FirstName: 'Taylor' } }],
    [
      'update_candidate',
      mocks.update_candidate,
      { candidateNumber: '1', body: { FirstName: 'Taylor' } },
    ],
    ['delete_candidate', mocks.delete_candidate, { candidateNumber: '1' }],
    ['list_candidate_phones', mocks.list_candidate_phones, { candidateNumber: '1' }],
    ['get_candidate_phone', mocks.get_candidate_phone, { candidateNumber: '1', phoneId: '1' }],
    [
      'create_candidate_phone',
      mocks.create_candidate_phone,
      { candidateNumber: '1', body: { PhoneNumber: '5550100' } },
    ],
    [
      'update_candidate_phone',
      mocks.update_candidate_phone,
      { candidateNumber: '1', phoneId: '1', body: { PhoneNumber: '5550100' } },
    ],
    [
      'delete_candidate_phone',
      mocks.delete_candidate_phone,
      { candidateNumber: '1', phoneId: '1' },
    ],
    ['list_candidate_education', mocks.list_candidate_education, { candidateNumber: '1' }],
    ['list_candidate_experience', mocks.list_candidate_experience, { candidateNumber: '1' }],
    ['list_candidate_skills', mocks.list_candidate_skills, { candidateNumber: '1' }],
    ['list_candidate_attachments', mocks.list_candidate_attachments, { candidateNumber: '1' }],
    ['list_requisitions', mocks.list_requisitions, {}],
    ['get_requisition', mocks.get_requisition, { requisitionId: '1' }],
    [
      'create_requisition',
      mocks.create_requisition,
      {
        body: {
          Title: 'Engineer',
          RecruitingType: 'ORA_PROFESSIONAL',
          HiringManagerId: '9007199254740993',
          RecruiterId: '2',
          PrimaryLocationId: '3',
          PhaseId: '1',
          StateId: '21',
          UnlimitedOpenings: 'N',
          NumberOfOpenings: 1,
        },
      },
    ],
    [
      'update_requisition',
      mocks.update_requisition,
      { requisitionId: '1', body: { Title: 'Engineer' } },
    ],
    ['delete_requisition', mocks.delete_requisition, { requisitionId: '1' }],
    ['list_requisition_postings', mocks.list_requisition_postings, { requisitionId: '1' }],
    ['list_applications', mocks.list_applications, {}],
    ['get_application', mocks.get_application, { applicationId: '1' }],
    ['list_offers', mocks.list_offers, {}],
    ['get_offer', mocks.get_offer, { offerId: '1' }],
    ['list_interview_schedules', mocks.list_interview_schedules, {}],
    ['get_interview_schedule', mocks.get_interview_schedule, { scheduleId: '1' }],
    ['list_requisition_templates', mocks.list_requisition_templates, {}],
    ['list_recruiting_representatives', mocks.list_recruiting_representatives, {}],
  ])('dispatches %s', async (action, operation, input) => {
    const response = await invoke({
      toolId: `oracle_fusion_recruiting_${action}`,
      input: { ...auth, ...input },
    })
    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledOnce()
  })
  it('rejects invalid input before provider execution', async () => {
    expect((await invoke({ input: { ...auth, limit: 101 } })).status).toBe(400)
    expect(mocks.list_candidates).not.toHaveBeenCalled()
  })
  it.each([401, 403, 404, 429, 502, 504])('preserves safe provider status %s', async (status) => {
    mocks.list_candidates.mockRejectedValue(
      new OracleFusionProviderError('Provider unavailable', status)
    )
    expect((await invoke()).status).toBe(status)
  })
  it('does not expose unknown internal exceptions', async () => {
    mocks.list_candidates.mockRejectedValue(new Error('private-token'))
    const response = await invoke()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private-token')
  })
  it('rejects aborted execution before calling a provider', async () => {
    await expect(invoke({ signal: AbortSignal.abort() })).rejects.toThrow()
    expect(mocks.list_candidates).not.toHaveBeenCalled()
  })
})
