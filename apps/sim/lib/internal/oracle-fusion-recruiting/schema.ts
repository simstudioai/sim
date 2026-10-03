import { z } from 'zod'

export const decimalIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,18}$/, 'ID must be a positive decimal string of at most 19 digits')
  .refine(
    (value) => !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) <= 9_223_372_036_854_775_807n,
    'ID exceeds int64 range'
  )

export const stringIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(
    /^[a-zA-Z0-9_.-]+$/,
    'ID must contain only letters, digits, underscores, periods, or hyphens'
  )

const baseSchema = z.object({
  instanceUrl: z.string().min(1).max(2048),
  accessToken: z.string().min(1).max(4096),
})
const pagination = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}
const searchSchema = z.string().trim().min(1).max(200).optional()

/** Documented scalar fields for recruitingcandidates-post. */
export const createCandidateFieldsSchema = z
  .object({
    FirstName: z.string().max(150).nullable().optional(),
    LastName: z.string().max(150).nullable().optional(),
    MiddleNames: z.string().max(80).nullable().optional(),
    Email: z.string().max(240).nullable().optional(),
    KnownAs: z.string().max(80).nullable().optional(),
    Title: z.string().max(30).nullable().optional(),
    Suffix: z.string().max(80).nullable().optional(),
    PreNameAdjunct: z.string().max(150).nullable().optional(),
    PreviousLastName: z.string().max(150).nullable().optional(),
    PreferredLanguage: z.string().max(4).nullable().optional(),
    PreferredTimezone: z.string().max(255).nullable().optional(),
    CampaignOptIn: z.string().max(1).nullable().optional(),
    SourceMedium: z.string().max(32).nullable().optional(),
    SourceName: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

/** Documented scalar fields for recruitingcandidates-candidatenumber-patch. */
export const updateCandidateFieldsSchema = z
  .object({
    FirstName: z.string().max(150).nullable().optional(),
    LastName: z.string().max(150).nullable().optional(),
    MiddleNames: z.string().max(80).nullable().optional(),
    Email: z.string().max(240).nullable().optional(),
    KnownAs: z.string().max(80).nullable().optional(),
    Title: z.string().max(30).nullable().optional(),
    Suffix: z.string().max(80).nullable().optional(),
    PreNameAdjunct: z.string().max(150).nullable().optional(),
    PreviousLastName: z.string().max(150).nullable().optional(),
    PreferredLanguage: z.string().max(4).nullable().optional(),
    PreferredTimezone: z.string().max(255).nullable().optional(),
    CampaignOptIn: z.string().max(1).nullable().optional(),
    SourceMedium: z.string().max(32).nullable().optional(),
    SourceName: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

/** Documented scalar fields for recruitingcandidates-candidatenumber-child-candidatephones-post. */
export const createPhoneFieldsSchema = z
  .object({
    PhoneNumber: z.string().max(60).nullable().optional(),
    CountryCodeNumber: z.string().max(30).nullable().optional(),
    AreaCode: z.string().max(30).nullable().optional(),
    LegislationCode: z.string().max(4).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

/** Documented scalar fields for recruitingcandidates-candidatenumber-child-candidatephones-phoneid-patch. */
export const updatePhoneFieldsSchema = z
  .object({
    PhoneNumber: z.string().max(60).nullable().optional(),
    CountryCodeNumber: z.string().max(30).nullable().optional(),
    AreaCode: z.string().max(30).nullable().optional(),
    LegislationCode: z.string().max(4).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

/** Documented scalar fields for recruitingjobrequisitions-post. */
export const createRequisitionFieldsSchema = z
  .object({
    Title: z.string().max(240).min(1),
    RequisitionNumber: z.string().max(240).nullable().optional(),
    RecruitingType: z.string().max(30).min(1),
    HiringManagerId: decimalIdSchema,
    RecruiterId: decimalIdSchema,
    PrimaryLocationId: decimalIdSchema,
    PhaseId: decimalIdSchema,
    StateId: decimalIdSchema,
    UnlimitedOpenings: z.string().max(1).min(1),
    NumberOfOpenings: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable().optional(),
    TemplateId: decimalIdSchema.nullable().optional(),
    HiringManagerAssignmentId: decimalIdSchema.nullable().optional(),
    RecruiterAssignmentId: decimalIdSchema.nullable().optional(),
    BusinessUnitId: decimalIdSchema.nullable().optional(),
    DepartmentId: decimalIdSchema.nullable().optional(),
    JobId: decimalIdSchema.nullable().optional(),
    JobFamilyId: decimalIdSchema.nullable().optional(),
    PositionId: decimalIdSchema.nullable().optional(),
    GradeId: decimalIdSchema.nullable().optional(),
    LegalEmployerId: decimalIdSchema.nullable().optional(),
    OrganizationId: decimalIdSchema.nullable().optional(),
    PrimaryWorkLocationId: decimalIdSchema.nullable().optional(),
    CandidateSelectionProcessId: decimalIdSchema.nullable().optional(),
    WorkerType: z.string().max(30).nullable().optional(),
    JobType: z.string().max(30).nullable().optional(),
    FullTimeOrPartTime: z.string().max(30).nullable().optional(),
    RegularOrTemporary: z.string().max(30).nullable().optional(),
    WorkplaceTypeCode: z.string().max(30).nullable().optional(),
    BusinessJustification: z.string().max(30).nullable().optional(),
    ExternalContactName: z.string().max(240).nullable().optional(),
    ExternalContactEmail: z.string().max(240).nullable().optional(),
    InternalContactName: z.string().max(240).nullable().optional(),
    InternalContactEmail: z.string().max(240).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

/** Documented scalar fields for recruitingjobrequisitions-recruitingjobrequisitionsuniqid-patch. */
export const updateRequisitionFieldsSchema = z
  .object({
    Title: z.string().max(240).optional(),
    RequisitionNumber: z.string().max(240).nullable().optional(),
    RecruitingType: z.string().max(30).optional(),
    HiringManagerId: decimalIdSchema.optional(),
    RecruiterId: decimalIdSchema.optional(),
    PrimaryLocationId: decimalIdSchema.optional(),
    PhaseId: decimalIdSchema.optional(),
    StateId: decimalIdSchema.optional(),
    UnlimitedOpenings: z.string().max(1).optional(),
    NumberOfOpenings: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable().optional(),
    TemplateId: decimalIdSchema.nullable().optional(),
    HiringManagerAssignmentId: decimalIdSchema.nullable().optional(),
    RecruiterAssignmentId: decimalIdSchema.nullable().optional(),
    BusinessUnitId: decimalIdSchema.nullable().optional(),
    DepartmentId: decimalIdSchema.nullable().optional(),
    JobId: decimalIdSchema.nullable().optional(),
    JobFamilyId: decimalIdSchema.nullable().optional(),
    PositionId: decimalIdSchema.nullable().optional(),
    GradeId: decimalIdSchema.nullable().optional(),
    LegalEmployerId: decimalIdSchema.nullable().optional(),
    OrganizationId: decimalIdSchema.nullable().optional(),
    PrimaryWorkLocationId: decimalIdSchema.nullable().optional(),
    CandidateSelectionProcessId: decimalIdSchema.nullable().optional(),
    WorkerType: z.string().max(30).nullable().optional(),
    JobType: z.string().max(30).nullable().optional(),
    FullTimeOrPartTime: z.string().max(30).nullable().optional(),
    RegularOrTemporary: z.string().max(30).nullable().optional(),
    WorkplaceTypeCode: z.string().max(30).nullable().optional(),
    BusinessJustification: z.string().max(30).nullable().optional(),
    ExternalContactName: z.string().max(240).nullable().optional(),
    ExternalContactEmail: z.string().max(240).nullable().optional(),
    InternalContactName: z.string().max(240).nullable().optional(),
    InternalContactEmail: z.string().max(240).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field'
  )

export const candidateSchema = z.object({
  candidateNumber: z.string(),
  personId: z.string().nullable(),
  displayName: z.string().nullable(),
  fullName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  middleNames: z.string().nullable(),
  email: z.string().nullable(),
  candidateType: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  preferredTimezone: z.string().nullable(),
  creationDate: z.string().nullable(),
  lastUpdateDate: z.string().nullable(),
})
export type Candidate = z.infer<typeof candidateSchema>

export const phoneSchema = z.object({
  phoneId: z.string(),
  phoneNumber: z.string().nullable(),
  countryCodeNumber: z.string().nullable(),
  areaCode: z.string().nullable(),
  legislationCode: z.string().nullable(),
  phoneType: z.string().nullable(),
})
export type Phone = z.infer<typeof phoneSchema>

export const educationSchema = z.object({
  educationId: z.string(),
  degreeName: z.string().nullable(),
  major: z.string().nullable(),
  minor: z.string().nullable(),
  educationalEstablishment: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  graduatedFlag: z.boolean().nullable(),
})
export type Education = z.infer<typeof educationSchema>

export const experienceSchema = z.object({
  previousEmploymentId: z.string(),
  employerName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  currentJobFlag: z.boolean().nullable(),
  department: z.string().nullable(),
})
export type Experience = z.infer<typeof experienceSchema>

export const skillSchema = z.object({
  skillId: z.string(),
  skill: z.string().nullable(),
  description: z.string().nullable(),
  yearsOfExperience: z.string().nullable(),
  dateAchieved: z.string().nullable(),
  speciality: z.string().nullable(),
})
export type Skill = z.infer<typeof skillSchema>

export const attachmentSchema = z.object({
  attachedDocumentId: z.string(),
  fileName: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  uploadedFileContentType: z.string().nullable(),
  uploadedFileLength: z.number().nullable(),
  categoryName: z.string().nullable(),
  creationDate: z.string().nullable(),
  lastUpdateDate: z.string().nullable(),
})
export type Attachment = z.infer<typeof attachmentSchema>

export const requisitionSchema = z.object({
  requisitionId: z.string(),
  requisitionNumber: z.string().nullable(),
  title: z.string().nullable(),
  recruitingType: z.string().nullable(),
  phaseId: z.string().nullable(),
  phaseName: z.string().nullable(),
  stateId: z.string().nullable(),
  stateName: z.string().nullable(),
  hiringManagerId: z.string().nullable(),
  recruiterId: z.string().nullable(),
  primaryLocationId: z.string().nullable(),
  businessUnitId: z.string().nullable(),
  departmentId: z.string().nullable(),
  jobId: z.string().nullable(),
  numberOfOpenings: z.number().nullable(),
  unlimitedOpenings: z.string().nullable(),
  creationDate: z.string().nullable(),
  lastUpdateDate: z.string().nullable(),
})
export type Requisition = z.infer<typeof requisitionSchema>

export const postingSchema = z.object({
  publishedJobId: z.string(),
  postingStatus: z.string().nullable(),
  visibility: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  timeZone: z.string().nullable(),
})
export type Posting = z.infer<typeof postingSchema>

export const applicationSchema = z.object({
  jobApplicationId: z.string(),
  candidateName: z.string().nullable(),
  candidatePersonId: z.string().nullable(),
  requisitionId: z.string().nullable(),
  requisitionNumber: z.string().nullable(),
  phaseId: z.string().nullable(),
  phaseName: z.string().nullable(),
  stateId: z.string().nullable(),
  stateName: z.string().nullable(),
  confirmedFlag: z.boolean().nullable(),
  disqualifiedFlag: z.boolean().nullable(),
  internalFlag: z.boolean().nullable(),
  jobApplicationDate: z.string().nullable(),
  lastUpdateDate: z.string().nullable(),
})
export type Application = z.infer<typeof applicationSchema>

export const offerSchema = z.object({
  offerId: z.string(),
  offerName: z.string().nullable(),
  jobApplicationId: z.string().nullable(),
  candidatePersonId: z.string().nullable(),
  requisitionId: z.string().nullable(),
  phaseId: z.string().nullable(),
  phaseName: z.string().nullable(),
  stateId: z.string().nullable(),
  stateName: z.string().nullable(),
  hireDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  lastUpdateDate: z.string().nullable(),
})
export type Offer = z.infer<typeof offerSchema>

export const interviewScheduleSchema = z.object({
  scheduleId: z.string(),
  scheduleCode: z.string().nullable(),
  scheduleTitle: z.string().nullable(),
  scheduleType: z.string().nullable(),
  interviewType: z.string().nullable(),
  interviewTypeMeaning: z.string().nullable(),
  status: z.string().nullable(),
})
export type InterviewSchedule = z.infer<typeof interviewScheduleSchema>

export const requisitionTemplateSchema = z.object({
  requisitionId: z.string(),
  requisitionNumber: z.string().nullable(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  requisitionNameWithNumber: z.string().nullable(),
})
export type RequisitionTemplate = z.infer<typeof requisitionTemplateSchema>

export const representativeSchema = z.object({
  personId: z.string(),
  personNumber: z.string().nullable(),
  displayName: z.string().nullable(),
  assignmentId: z.string().nullable(),
  assignmentNumber: z.string().nullable(),
  workEmailAddress: z.string().nullable(),
})
export type Representative = z.infer<typeof representativeSchema>

export const listCandidatesSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
})
export type ListCandidatesInput = z.infer<typeof listCandidatesSchema>

export const getCandidateSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
})
export type GetCandidateInput = z.infer<typeof getCandidateSchema>

export const createCandidateSchema = baseSchema.extend({
  body: createCandidateFieldsSchema,
})
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>

export const updateCandidateSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  body: updateCandidateFieldsSchema,
})
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>

export const deleteCandidateSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
})
export type DeleteCandidateInput = z.infer<typeof deleteCandidateSchema>

export const listCandidatePhonesSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  ...pagination,
})
export type ListCandidatePhonesInput = z.infer<typeof listCandidatePhonesSchema>

export const getCandidatePhoneSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  phoneId: stringIdSchema,
})
export type GetCandidatePhoneInput = z.infer<typeof getCandidatePhoneSchema>

export const createCandidatePhoneSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  body: createPhoneFieldsSchema,
})
export type CreateCandidatePhoneInput = z.infer<typeof createCandidatePhoneSchema>

export const updateCandidatePhoneSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  phoneId: stringIdSchema,
  body: updatePhoneFieldsSchema,
})
export type UpdateCandidatePhoneInput = z.infer<typeof updateCandidatePhoneSchema>

export const deleteCandidatePhoneSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  phoneId: stringIdSchema,
})
export type DeleteCandidatePhoneInput = z.infer<typeof deleteCandidatePhoneSchema>

export const listCandidateEducationSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  ...pagination,
})
export type ListCandidateEducationInput = z.infer<typeof listCandidateEducationSchema>

export const listCandidateExperienceSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  ...pagination,
})
export type ListCandidateExperienceInput = z.infer<typeof listCandidateExperienceSchema>

export const listCandidateSkillsSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  ...pagination,
})
export type ListCandidateSkillsInput = z.infer<typeof listCandidateSkillsSchema>

export const listCandidateAttachmentsSchema = baseSchema.extend({
  candidateNumber: stringIdSchema,
  ...pagination,
})
export type ListCandidateAttachmentsInput = z.infer<typeof listCandidateAttachmentsSchema>

export const listRequisitionsSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
})
export type ListRequisitionsInput = z.infer<typeof listRequisitionsSchema>

export const getRequisitionSchema = baseSchema.extend({
  requisitionId: decimalIdSchema,
})
export type GetRequisitionInput = z.infer<typeof getRequisitionSchema>

export const createRequisitionSchema = baseSchema.extend({
  body: createRequisitionFieldsSchema,
})
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>

export const updateRequisitionSchema = baseSchema.extend({
  requisitionId: decimalIdSchema,
  body: updateRequisitionFieldsSchema,
})
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>

export const deleteRequisitionSchema = baseSchema.extend({
  requisitionId: decimalIdSchema,
})
export type DeleteRequisitionInput = z.infer<typeof deleteRequisitionSchema>

export const listRequisitionPostingsSchema = baseSchema.extend({
  requisitionId: decimalIdSchema,
  ...pagination,
})
export type ListRequisitionPostingsInput = z.infer<typeof listRequisitionPostingsSchema>

export const listApplicationsSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
  requisitionId: decimalIdSchema.optional(),
})
export type ListApplicationsInput = z.infer<typeof listApplicationsSchema>

export const getApplicationSchema = baseSchema.extend({
  applicationId: decimalIdSchema,
})
export type GetApplicationInput = z.infer<typeof getApplicationSchema>

export const listOffersSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
  requisitionId: decimalIdSchema.optional(),
})
export type ListOffersInput = z.infer<typeof listOffersSchema>

export const getOfferSchema = baseSchema.extend({
  offerId: decimalIdSchema,
})
export type GetOfferInput = z.infer<typeof getOfferSchema>

export const listInterviewSchedulesSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
})
export type ListInterviewSchedulesInput = z.infer<typeof listInterviewSchedulesSchema>

export const getInterviewScheduleSchema = baseSchema.extend({
  scheduleId: decimalIdSchema,
})
export type GetInterviewScheduleInput = z.infer<typeof getInterviewScheduleSchema>

export const listRequisitionTemplatesSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
})
export type ListRequisitionTemplatesInput = z.infer<typeof listRequisitionTemplatesSchema>

export const listRecruitingRepresentativesSchema = baseSchema.extend({
  ...pagination,
  search: searchSchema,
})
export type ListRecruitingRepresentativesInput = z.infer<typeof listRecruitingRepresentativesSchema>
