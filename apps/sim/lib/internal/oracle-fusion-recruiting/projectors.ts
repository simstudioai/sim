import { isRecordLike } from '@sim/utils/object'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import type * as Schemas from '@/lib/internal/oracle-fusion-recruiting/schema'

function invalid(): never {
  throw new OracleFusionProviderError('Oracle Fusion Recruiting returned an invalid resource', 502)
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecordLike(value)) return invalid()
  return value
}
function text(value: unknown): string | null {
  if (value == null) return null
  return typeof value === 'string' ? value : invalid()
}
function identifier(value: unknown): string {
  const normalized = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (
    normalized === undefined ||
    normalized === '0' ||
    BigInt(normalized) > 9_223_372_036_854_775_807n
  )
    return invalid()
  return normalized
}
function stringIdentifier(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : invalid()
}
function integerValue(value: unknown): string | null {
  if (value == null) return null
  const negative =
    typeof value === 'number' ? value < 0 : typeof value === 'string' && value.startsWith('-')
  const magnitude = negative ? (typeof value === 'number' ? -value : String(value).slice(1)) : value
  const normalized = normalizeOracleFusionDecimalIdentifier(magnitude, { maxDigits: 19 })
  if (
    normalized === undefined ||
    BigInt(normalized) > (negative ? 9_223_372_036_854_775_808n : 9_223_372_036_854_775_807n)
  )
    return invalid()
  return negative && normalized !== '0' ? `-${normalized}` : normalized
}
function optionalIdentifier(value: unknown): string | null {
  return value == null ? null : identifier(value)
}
function number(value: unknown): number | null {
  if (value == null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : invalid()
}
function boolean(value: unknown): boolean | null {
  if (value == null) return null
  return typeof value === 'boolean' ? value : invalid()
}

export function projectCandidate(value: unknown): Schemas.Candidate {
  const item = record(value)
  return {
    candidateNumber: stringIdentifier(item.CandidateNumber),
    personId: optionalIdentifier(item.PersonId),
    displayName: text(item.DisplayName),
    fullName: text(item.FullName),
    firstName: text(item.FirstName),
    lastName: text(item.LastName),
    middleNames: text(item.MiddleNames),
    email: text(item.Email),
    candidateType: text(item.CandidateType),
    preferredLanguage: text(item.PreferredLanguage),
    preferredTimezone: text(item.PreferredTimezone),
    creationDate: text(item.CreationDate),
    lastUpdateDate: text(item.LastUpdateDate),
  }
}

export function projectPhone(value: unknown): Schemas.Phone {
  const item = record(value)
  return {
    phoneId: stringIdentifier(item.PhoneId),
    phoneNumber: text(item.PhoneNumber),
    countryCodeNumber: text(item.CountryCodeNumber),
    areaCode: text(item.AreaCode),
    legislationCode: text(item.LegislationCode),
    phoneType: text(item.PhoneType),
  }
}

export function projectEducation(value: unknown): Schemas.Education {
  const item = record(value)
  return {
    educationId: identifier(item.EducationId),
    degreeName: text(item.DegreeName),
    major: text(item.Major),
    minor: text(item.Minor),
    educationalEstablishment: text(item.EducationalEstablishment),
    startDate: text(item.StartDate),
    endDate: text(item.EndDate),
    graduatedFlag: boolean(item.GraduatedFlag),
  }
}

export function projectExperience(value: unknown): Schemas.Experience {
  const item = record(value)
  return {
    previousEmploymentId: identifier(item.PreviousEmploymentId),
    employerName: text(item.EmployerName),
    jobTitle: text(item.JobTitle),
    startDate: text(item.StartDate),
    endDate: text(item.EndDate),
    currentJobFlag: boolean(item.CurrentJobFlag),
    department: text(item.Department),
  }
}

export function projectSkill(value: unknown): Schemas.Skill {
  const item = record(value)
  return {
    skillId: identifier(item.SkillId),
    skill: text(item.Skill),
    description: text(item.Description),
    yearsOfExperience: integerValue(item.YearsOfExperience),
    dateAchieved: text(item.DateAchieved),
    speciality: text(item.Speciality),
  }
}

export function projectAttachment(value: unknown): Schemas.Attachment {
  const item = record(value)
  return {
    attachedDocumentId: identifier(item.AttachedDocumentId),
    fileName: text(item.FileName),
    title: text(item.Title),
    description: text(item.Description),
    uploadedFileContentType: text(item.UploadedFileContentType),
    uploadedFileLength: number(item.UploadedFileLength),
    categoryName: text(item.CategoryName),
    creationDate: text(item.CreationDate),
    lastUpdateDate: text(item.LastUpdateDate),
  }
}

export function projectRequisition(value: unknown): Schemas.Requisition {
  const item = record(value)
  return {
    requisitionId: identifier(item.RequisitionId),
    requisitionNumber: text(item.RequisitionNumber),
    title: text(item.Title),
    recruitingType: text(item.RecruitingType),
    phaseId: optionalIdentifier(item.PhaseId),
    phaseName: text(item.PhaseName),
    stateId: optionalIdentifier(item.StateId),
    stateName: text(item.StateName),
    hiringManagerId: optionalIdentifier(item.HiringManagerId),
    recruiterId: optionalIdentifier(item.RecruiterId),
    primaryLocationId: optionalIdentifier(item.PrimaryLocationId),
    businessUnitId: optionalIdentifier(item.BusinessUnitId),
    departmentId: optionalIdentifier(item.DepartmentId),
    jobId: optionalIdentifier(item.JobId),
    numberOfOpenings: number(item.NumberOfOpenings),
    unlimitedOpenings: text(item.UnlimitedOpenings),
    creationDate: text(item.CreationDate),
    lastUpdateDate: text(item.LastUpdateDate),
  }
}

export function projectPosting(value: unknown): Schemas.Posting {
  const item = record(value)
  return {
    publishedJobId: identifier(item.PublishedJobId),
    postingStatus: text(item.PostingStatus),
    visibility: text(item.Visibility),
    startDate: text(item.StartDate),
    endDate: text(item.EndDate),
    timeZone: text(item.TimeZone),
  }
}

export function projectApplication(value: unknown): Schemas.Application {
  const item = record(value)
  return {
    jobApplicationId: identifier(item.JobApplicationId),
    candidateName: text(item.CandidateName),
    candidatePersonId: optionalIdentifier(item.CandidatePersonId),
    requisitionId: optionalIdentifier(item.RequisitionId),
    requisitionNumber: text(item.RequisitionNumber),
    phaseId: optionalIdentifier(item.PhaseId),
    phaseName: text(item.PhaseName),
    stateId: optionalIdentifier(item.StateId),
    stateName: text(item.StateName),
    confirmedFlag: boolean(item.ConfirmedFlag),
    disqualifiedFlag: boolean(item.DisqualifiedFlag),
    internalFlag: boolean(item.InternalFlag),
    jobApplicationDate: text(item.JobApplicationDate),
    lastUpdateDate: text(item.LastUpdateDate),
  }
}

export function projectOffer(value: unknown): Schemas.Offer {
  const item = record(value)
  return {
    offerId: identifier(item.OfferId),
    offerName: text(item.OfferName),
    jobApplicationId: optionalIdentifier(item.JobApplicationId),
    candidatePersonId: optionalIdentifier(item.CandidatePersonId),
    requisitionId: optionalIdentifier(item.RequisitionId),
    phaseId: optionalIdentifier(item.PhaseId),
    phaseName: text(item.PhaseName),
    stateId: optionalIdentifier(item.StateId),
    stateName: text(item.StateName),
    hireDate: text(item.HireDate),
    expirationDate: text(item.ExpirationDate),
    lastUpdateDate: text(item.LastUpdateDate),
  }
}

export function projectInterviewSchedule(value: unknown): Schemas.InterviewSchedule {
  const item = record(value)
  return {
    scheduleId: identifier(item.ScheduleId),
    scheduleCode: text(item.ScheduleCode),
    scheduleTitle: text(item.ScheduleTitle),
    scheduleType: text(item.ScheduleType),
    interviewType: text(item.InterviewType),
    interviewTypeMeaning: text(item.InterviewTypeMeaning),
    status: text(item.Status),
  }
}

export function projectRequisitionTemplate(value: unknown): Schemas.RequisitionTemplate {
  const item = record(value)
  return {
    requisitionId: identifier(item.RequisitionId),
    requisitionNumber: text(item.RequisitionNumber),
    name: text(item.Name),
    title: text(item.Title),
    requisitionNameWithNumber: text(item.RequisitionNameWithNumber),
  }
}

export function projectRepresentative(value: unknown): Schemas.Representative {
  const item = record(value)
  return {
    personId: identifier(item.PersonId),
    personNumber: text(item.PersonNumber),
    displayName: text(item.DisplayName),
    assignmentId: optionalIdentifier(item.AssignmentId),
    assignmentNumber: text(item.AssignmentNumber),
    workEmailAddress: text(item.WorkEmailAddress),
  }
}
