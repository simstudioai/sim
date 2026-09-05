import {
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import * as projectors from '@/lib/internal/oracle-fusion-recruiting/projectors'
import type * as Schemas from '@/lib/internal/oracle-fusion-recruiting/schema'

type Credentials = OracleFusionResolvedCredential
type PageInput = Credentials & { limit?: number; offset?: number; search?: string }
type Query = Record<string, string | number | boolean | undefined>

function invalid(message = 'Oracle Fusion Recruiting returned an invalid resource'): never {
  throw new OracleFusionProviderError(message, 502)
}

function quoteSearch(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[%_*?]/g, '\\$&')
    .replace(/'/g, "''")
}

async function list<T>(
  input: PageInput,
  path: string,
  fields: string,
  project: (value: unknown) => T,
  searchFields: string[],
  query: Query,
  signal?: AbortSignal
) {
  const clauses: string[] = []
  if (input.search && searchFields.length) {
    const term = quoteSearch(input.search)
    clauses.push(`(${searchFields.map((field) => `${field} LIKE '%${term}%'`).join(' OR ')})`)
  }
  if (query.q) clauses.push(String(query.q))
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'hcm', relativePath: path },
      query: {
        ...query,
        fields,
        onlyData: true,
        limit: input.limit ?? 20,
        offset: input.offset ?? 0,
        ...(clauses.length ? { q: clauses.join(' AND ') } : {}),
      },
    },
    signal
  )
  signal?.throwIfAborted()
  try {
    const result = parseOracleFusionCollection(raw, project, {
      expectedOffset: input.offset ?? 0,
      maxItems: input.limit ?? 20,
    })
    const { items, nextOffset, ...page } = result
    return { items, page: { ...page, ...(page.hasMore ? { nextOffset } : {}) } }
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    return invalid('Oracle Fusion Recruiting returned an invalid collection')
  }
}

async function lookup<T>(
  input: Credentials,
  path: string,
  fields: string,
  keyField: string,
  id: string,
  project: (value: unknown) => T,
  identity: (value: T) => string,
  signal?: AbortSignal
) {
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'hcm', relativePath: path },
      query: { fields, finder: `PrimaryKey;${keyField}=${id}`, links: 'self', limit: 2, offset: 0 },
    },
    signal
  )
  signal?.throwIfAborted()
  try {
    const page = parseOracleFusionCollection(raw, (item) => ({ raw: item, value: project(item) }), {
      expectedOffset: 0,
      maxItems: 2,
    })
    if (!page.items.length && !page.hasMore) {
      throw new OracleFusionProviderError('Oracle Fusion Recruiting resource was not found', 404)
    }
    if (page.items.length !== 1 || page.hasMore)
      return invalid('Oracle Fusion Recruiting returned an ambiguous identifier')
    const match = page.items[0]
    if (identity(match.value) !== id)
      return invalid('Oracle Fusion Recruiting returned a different identifier')
    const key = extractOracleFusionOpaqueKey(match.raw, input.instanceUrl, {
      family: 'hcm',
      relativePath: path,
    })
    return { value: match.value, path: `${path}/${encodeOracleFusionPathSegment(key)}` }
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    return invalid('Oracle Fusion Recruiting returned an invalid resource link')
  }
}

async function get<T>(
  input: Credentials,
  path: string,
  fields: string,
  project: (value: unknown) => T,
  identity: (value: T) => string,
  id: string,
  signal?: AbortSignal
) {
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'hcm', relativePath: path },
      query: { fields, links: 'self' },
    },
    signal
  )
  signal?.throwIfAborted()
  try {
    validateOracleFusionSelfLink(raw, input.instanceUrl, { family: 'hcm', relativePath: path })
    const value = project(raw)
    if (identity(value) !== id)
      return invalid('Oracle Fusion Recruiting returned a different identifier')
    return value
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    return invalid()
  }
}

function writeBody(body: Record<string, unknown>, integerFields: readonly string[]) {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    result[key] =
      typeof value === 'string' && integerFields.includes(key)
        ? oracleFusionExactInteger(value)
        : value
  }
  return result
}

async function mutate<T>(
  input: Credentials,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  project: (value: unknown) => T,
  signal?: AbortSignal
) {
  const raw = await requestOracleFusionJson(
    input,
    {
      address: { family: 'hcm', relativePath: path },
      method,
      body,
      mediaType: 'application/json',
    },
    signal
  )
  signal?.throwIfAborted()
  return project(raw)
}

const CANDIDATE_FIELDS =
  'CandidateNumber,PersonId,DisplayName,FullName,FirstName,LastName,MiddleNames,Email,CandidateType,PreferredLanguage,PreferredTimezone,CreationDate,LastUpdateDate'
const PHONE_FIELDS = 'PhoneId,PhoneNumber,CountryCodeNumber,AreaCode,LegislationCode,PhoneType'
const EDUCATION_FIELDS =
  'EducationId,DegreeName,Major,Minor,EducationalEstablishment,StartDate,EndDate,GraduatedFlag'
const EXPERIENCE_FIELDS =
  'PreviousEmploymentId,EmployerName,JobTitle,StartDate,EndDate,CurrentJobFlag,Department'
const SKILL_FIELDS = 'SkillId,Skill,Description,YearsOfExperience,DateAchieved,Speciality'
const ATTACHMENT_FIELDS =
  'AttachedDocumentId,FileName,Title,Description,UploadedFileContentType,UploadedFileLength,CategoryName,CreationDate,LastUpdateDate'
const REQUISITION_FIELDS =
  'RequisitionId,RequisitionNumber,Title,RecruitingType,PhaseId,PhaseName,StateId,StateName,HiringManagerId,RecruiterId,PrimaryLocationId,BusinessUnitId,DepartmentId,JobId,NumberOfOpenings,UnlimitedOpenings,CreationDate,LastUpdateDate'
const POSTING_FIELDS = 'PublishedJobId,PostingStatus,Visibility,StartDate,EndDate,TimeZone'
const APPLICATION_FIELDS =
  'JobApplicationId,CandidateName,CandidatePersonId,RequisitionId,RequisitionNumber,PhaseId,PhaseName,StateId,StateName,ConfirmedFlag,DisqualifiedFlag,InternalFlag,JobApplicationDate,LastUpdateDate'
const OFFER_FIELDS =
  'OfferId,OfferName,JobApplicationId,CandidatePersonId,RequisitionId,PhaseId,PhaseName,StateId,StateName,HireDate,ExpirationDate,LastUpdateDate'
const INTERVIEW_SCHEDULE_FIELDS =
  'ScheduleId,ScheduleCode,ScheduleTitle,ScheduleType,InterviewType,InterviewTypeMeaning,Status'
const REQUISITION_TEMPLATE_FIELDS =
  'RequisitionId,RequisitionNumber,Name,Title,RequisitionNameWithNumber'
const REPRESENTATIVE_FIELDS =
  'PersonId,PersonNumber,DisplayName,AssignmentId,AssignmentNumber,WorkEmailAddress'

async function resolveCandidate(
  input: Credentials & { candidateNumber: string },
  signal?: AbortSignal
) {
  return lookup(
    input,
    'recruitingCandidates',
    CANDIDATE_FIELDS,
    'CandidateNumber',
    input.candidateNumber,
    projectors.projectCandidate,
    (value) => value.candidateNumber,
    signal
  )
}

async function resolveRequisition(
  input: Credentials & { requisitionId: string },
  signal?: AbortSignal
) {
  return lookup(
    input,
    'recruitingJobRequisitions',
    REQUISITION_FIELDS,
    'RequisitionId',
    input.requisitionId,
    projectors.projectRequisition,
    (value) => value.requisitionId,
    signal
  )
}

export async function executeListCandidates(
  input: Schemas.ListCandidatesInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingCandidates'
  const result = await list(
    input,
    collectionPath,
    CANDIDATE_FIELDS,
    projectors.projectCandidate,
    ['FullName', 'LastName'],
    {},
    signal
  )
  return { success: true as const, output: { candidates: result.items, ...result.page } }
}

export async function executeGetCandidate(input: Schemas.GetCandidateInput, signal?: AbortSignal) {
  const collectionPath = 'recruitingCandidates'
  const target = await lookup(
    input,
    collectionPath,
    CANDIDATE_FIELDS,
    'CandidateNumber',
    input.candidateNumber,
    projectors.projectCandidate,
    (value) => value.candidateNumber,
    signal
  )
  const candidate = await get(
    input,
    target.path,
    CANDIDATE_FIELDS,
    projectors.projectCandidate,
    (value) => value.candidateNumber,
    input.candidateNumber,
    signal
  )
  return { success: true as const, output: { candidate } }
}

export async function executeCreateCandidate(
  input: Schemas.CreateCandidateInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingCandidates'
  const candidate = await mutate(
    input,
    collectionPath,
    'POST',
    writeBody(input.body, []),
    projectors.projectCandidate,
    signal
  )
  return { success: true as const, output: { candidate } }
}

export async function executeUpdateCandidate(
  input: Schemas.UpdateCandidateInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingCandidates'
  const target = await lookup(
    input,
    collectionPath,
    CANDIDATE_FIELDS,
    'CandidateNumber',
    input.candidateNumber,
    projectors.projectCandidate,
    (value) => value.candidateNumber,
    signal
  )
  const candidate = await mutate(
    input,
    target.path,
    'PATCH',
    writeBody(input.body, []),
    projectors.projectCandidate,
    signal
  )
  if (candidate.candidateNumber !== input.candidateNumber)
    return invalid('Oracle Fusion Recruiting returned a different identifier')
  return { success: true as const, output: { candidate } }
}

export async function executeDeleteCandidate(
  input: Schemas.DeleteCandidateInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingCandidates'
  const target = await lookup(
    input,
    collectionPath,
    CANDIDATE_FIELDS,
    'CandidateNumber',
    input.candidateNumber,
    projectors.projectCandidate,
    (value) => value.candidateNumber,
    signal
  )
  await requestOracleFusionEmpty(
    input,
    { address: { family: 'hcm', relativePath: target.path }, method: 'DELETE' },
    signal
  )
  signal?.throwIfAborted()
  return { success: true as const, output: { deleted: true } }
}

export async function executeListCandidatePhones(
  input: Schemas.ListCandidatePhonesInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/candidatePhones`
  const result = await list(
    input,
    collectionPath,
    PHONE_FIELDS,
    projectors.projectPhone,
    [],
    {},
    signal
  )
  return { success: true as const, output: { phones: result.items, ...result.page } }
}

export async function executeGetCandidatePhone(
  input: Schemas.GetCandidatePhoneInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/candidatePhones`
  const target = await lookup(
    input,
    collectionPath,
    PHONE_FIELDS,
    'PhoneId',
    input.phoneId,
    projectors.projectPhone,
    (value) => value.phoneId,
    signal
  )
  const phone = await get(
    input,
    target.path,
    PHONE_FIELDS,
    projectors.projectPhone,
    (value) => value.phoneId,
    input.phoneId,
    signal
  )
  return { success: true as const, output: { phone } }
}

export async function executeCreateCandidatePhone(
  input: Schemas.CreateCandidatePhoneInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/candidatePhones`
  const phone = await mutate(
    input,
    collectionPath,
    'POST',
    writeBody(input.body, []),
    projectors.projectPhone,
    signal
  )
  return { success: true as const, output: { phone } }
}

export async function executeUpdateCandidatePhone(
  input: Schemas.UpdateCandidatePhoneInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/candidatePhones`
  const target = await lookup(
    input,
    collectionPath,
    PHONE_FIELDS,
    'PhoneId',
    input.phoneId,
    projectors.projectPhone,
    (value) => value.phoneId,
    signal
  )
  const phone = await mutate(
    input,
    target.path,
    'PATCH',
    writeBody(input.body, []),
    projectors.projectPhone,
    signal
  )
  if (phone.phoneId !== input.phoneId)
    return invalid('Oracle Fusion Recruiting returned a different identifier')
  return { success: true as const, output: { phone } }
}

export async function executeDeleteCandidatePhone(
  input: Schemas.DeleteCandidatePhoneInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/candidatePhones`
  const target = await lookup(
    input,
    collectionPath,
    PHONE_FIELDS,
    'PhoneId',
    input.phoneId,
    projectors.projectPhone,
    (value) => value.phoneId,
    signal
  )
  await requestOracleFusionEmpty(
    input,
    { address: { family: 'hcm', relativePath: target.path }, method: 'DELETE' },
    signal
  )
  signal?.throwIfAborted()
  return { success: true as const, output: { deleted: true } }
}

export async function executeListCandidateEducation(
  input: Schemas.ListCandidateEducationInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/education`
  const result = await list(
    input,
    collectionPath,
    EDUCATION_FIELDS,
    projectors.projectEducation,
    [],
    {},
    signal
  )
  return { success: true as const, output: { education: result.items, ...result.page } }
}

export async function executeListCandidateExperience(
  input: Schemas.ListCandidateExperienceInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/experience`
  const result = await list(
    input,
    collectionPath,
    EXPERIENCE_FIELDS,
    projectors.projectExperience,
    [],
    {},
    signal
  )
  return { success: true as const, output: { experience: result.items, ...result.page } }
}

export async function executeListCandidateSkills(
  input: Schemas.ListCandidateSkillsInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/skills`
  const result = await list(
    input,
    collectionPath,
    SKILL_FIELDS,
    projectors.projectSkill,
    [],
    {},
    signal
  )
  return { success: true as const, output: { skills: result.items, ...result.page } }
}

export async function executeListCandidateAttachments(
  input: Schemas.ListCandidateAttachmentsInput,
  signal?: AbortSignal
) {
  const parent = await resolveCandidate(input, signal)
  const collectionPath = `${parent.path}/child/attachments`
  const result = await list(
    input,
    collectionPath,
    ATTACHMENT_FIELDS,
    projectors.projectAttachment,
    [],
    {},
    signal
  )
  return { success: true as const, output: { attachments: result.items, ...result.page } }
}

export async function executeListRequisitions(
  input: Schemas.ListRequisitionsInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitions'
  const result = await list(
    input,
    collectionPath,
    REQUISITION_FIELDS,
    projectors.projectRequisition,
    ['RequisitionNumber', 'Title'],
    {},
    signal
  )
  return { success: true as const, output: { requisitions: result.items, ...result.page } }
}

export async function executeGetRequisition(
  input: Schemas.GetRequisitionInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitions'
  const target = await lookup(
    input,
    collectionPath,
    REQUISITION_FIELDS,
    'RequisitionId',
    input.requisitionId,
    projectors.projectRequisition,
    (value) => value.requisitionId,
    signal
  )
  const requisition = await get(
    input,
    target.path,
    REQUISITION_FIELDS,
    projectors.projectRequisition,
    (value) => value.requisitionId,
    input.requisitionId,
    signal
  )
  return { success: true as const, output: { requisition } }
}

export async function executeCreateRequisition(
  input: Schemas.CreateRequisitionInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitions'
  const requisition = await mutate(
    input,
    collectionPath,
    'POST',
    writeBody(input.body, [
      'HiringManagerId',
      'RecruiterId',
      'PrimaryLocationId',
      'PhaseId',
      'StateId',
      'TemplateId',
      'HiringManagerAssignmentId',
      'RecruiterAssignmentId',
      'BusinessUnitId',
      'DepartmentId',
      'JobId',
      'JobFamilyId',
      'PositionId',
      'GradeId',
      'LegalEmployerId',
      'OrganizationId',
      'PrimaryWorkLocationId',
      'CandidateSelectionProcessId',
    ]),
    projectors.projectRequisition,
    signal
  )
  return { success: true as const, output: { requisition } }
}

export async function executeUpdateRequisition(
  input: Schemas.UpdateRequisitionInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitions'
  const target = await lookup(
    input,
    collectionPath,
    REQUISITION_FIELDS,
    'RequisitionId',
    input.requisitionId,
    projectors.projectRequisition,
    (value) => value.requisitionId,
    signal
  )
  const requisition = await mutate(
    input,
    target.path,
    'PATCH',
    writeBody(input.body, [
      'HiringManagerId',
      'RecruiterId',
      'PrimaryLocationId',
      'PhaseId',
      'StateId',
      'TemplateId',
      'HiringManagerAssignmentId',
      'RecruiterAssignmentId',
      'BusinessUnitId',
      'DepartmentId',
      'JobId',
      'JobFamilyId',
      'PositionId',
      'GradeId',
      'LegalEmployerId',
      'OrganizationId',
      'PrimaryWorkLocationId',
      'CandidateSelectionProcessId',
    ]),
    projectors.projectRequisition,
    signal
  )
  if (requisition.requisitionId !== input.requisitionId)
    return invalid('Oracle Fusion Recruiting returned a different identifier')
  return { success: true as const, output: { requisition } }
}

export async function executeDeleteRequisition(
  input: Schemas.DeleteRequisitionInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitions'
  const target = await lookup(
    input,
    collectionPath,
    REQUISITION_FIELDS,
    'RequisitionId',
    input.requisitionId,
    projectors.projectRequisition,
    (value) => value.requisitionId,
    signal
  )
  await requestOracleFusionEmpty(
    input,
    { address: { family: 'hcm', relativePath: target.path }, method: 'DELETE' },
    signal
  )
  signal?.throwIfAborted()
  return { success: true as const, output: { deleted: true } }
}

export async function executeListRequisitionPostings(
  input: Schemas.ListRequisitionPostingsInput,
  signal?: AbortSignal
) {
  const parent = await resolveRequisition(input, signal)
  const collectionPath = `${parent.path}/child/publishedJobs`
  const result = await list(
    input,
    collectionPath,
    POSTING_FIELDS,
    projectors.projectPosting,
    [],
    {},
    signal
  )
  return { success: true as const, output: { postings: result.items, ...result.page } }
}

export async function executeListApplications(
  input: Schemas.ListApplicationsInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobApplications'
  const result = await list(
    input,
    collectionPath,
    APPLICATION_FIELDS,
    projectors.projectApplication,
    ['CandidateName', 'RequisitionNumber'],
    { ...(input.requisitionId ? { q: `RequisitionId=${input.requisitionId}` } : {}) },
    signal
  )
  return { success: true as const, output: { applications: result.items, ...result.page } }
}

export async function executeGetApplication(
  input: Schemas.GetApplicationInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobApplications'
  const target = await lookup(
    input,
    collectionPath,
    APPLICATION_FIELDS,
    'JobApplicationId',
    input.applicationId,
    projectors.projectApplication,
    (value) => value.jobApplicationId,
    signal
  )
  const application = await get(
    input,
    target.path,
    APPLICATION_FIELDS,
    projectors.projectApplication,
    (value) => value.jobApplicationId,
    input.applicationId,
    signal
  )
  return { success: true as const, output: { application } }
}

export async function executeListOffers(input: Schemas.ListOffersInput, signal?: AbortSignal) {
  const collectionPath = 'recruitingJobOffers'
  const result = await list(
    input,
    collectionPath,
    OFFER_FIELDS,
    projectors.projectOffer,
    ['OfferName'],
    { ...(input.requisitionId ? { q: `RequisitionId=${input.requisitionId}` } : {}) },
    signal
  )
  return { success: true as const, output: { offers: result.items, ...result.page } }
}

export async function executeGetOffer(input: Schemas.GetOfferInput, signal?: AbortSignal) {
  const collectionPath = 'recruitingJobOffers'
  const target = await lookup(
    input,
    collectionPath,
    OFFER_FIELDS,
    'OfferId',
    input.offerId,
    projectors.projectOffer,
    (value) => value.offerId,
    signal
  )
  const offer = target.value
  return { success: true as const, output: { offer } }
}

export async function executeListInterviewSchedules(
  input: Schemas.ListInterviewSchedulesInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingInterviewSchedulesLOV'
  const result = await list(
    input,
    collectionPath,
    INTERVIEW_SCHEDULE_FIELDS,
    projectors.projectInterviewSchedule,
    ['ScheduleTitle'],
    {},
    signal
  )
  return { success: true as const, output: { interviewSchedules: result.items, ...result.page } }
}

export async function executeGetInterviewSchedule(
  input: Schemas.GetInterviewScheduleInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingInterviewSchedulesLOV'
  const target = await lookup(
    input,
    collectionPath,
    INTERVIEW_SCHEDULE_FIELDS,
    'ScheduleId',
    input.scheduleId,
    projectors.projectInterviewSchedule,
    (value) => value.scheduleId,
    signal
  )
  const interviewSchedule = await get(
    input,
    target.path,
    INTERVIEW_SCHEDULE_FIELDS,
    projectors.projectInterviewSchedule,
    (value) => value.scheduleId,
    input.scheduleId,
    signal
  )
  return { success: true as const, output: { interviewSchedule } }
}

export async function executeListRequisitionTemplates(
  input: Schemas.ListRequisitionTemplatesInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingJobRequisitionTemplatesLOV'
  const result = await list(
    input,
    collectionPath,
    REQUISITION_TEMPLATE_FIELDS,
    projectors.projectRequisitionTemplate,
    ['Name', 'Title'],
    {},
    signal
  )
  return { success: true as const, output: { requisitionTemplates: result.items, ...result.page } }
}

export async function executeListRecruitingRepresentatives(
  input: Schemas.ListRecruitingRepresentativesInput,
  signal?: AbortSignal
) {
  const collectionPath = 'recruitingRepresentativesLOV'
  const result = await list(
    input,
    collectionPath,
    REPRESENTATIVE_FIELDS,
    projectors.projectRepresentative,
    ['DisplayName', 'PersonNumber'],
    {},
    signal
  )
  return { success: true as const, output: { representatives: result.items, ...result.page } }
}
