import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const OracleFusionRecruitingBlock: BlockConfig = {
  type: 'oracle_fusion_recruiting',
  name: 'Oracle Fusion Recruiting',
  description:
    'Manage candidates and requisitions, and read applications, offers, and recruiting lookups',
  longDescription:
    'Use a saved Oracle Fusion integration-user credential to manage candidates, candidate phones, and job requisitions. Read candidate education, experience, skills, attachment metadata, published jobs, applications, offers, interview schedule lookups, requisition templates, and recruiting representatives. Lists return one bounded page. Interview schedules contain lookup metadata, not appointments. Oracle privileges and data security govern access; use a dedicated least-privilege integration user. Write bodies accept only the documented scalar fields listed by each tool; nested child mutations and custom fields are not supported.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_recruiting',
  category: 'tools',
  integrationType: IntegrationType.HR,
  authMode: AuthMode.ApiKey,
  bgColor: '#F80000',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Recruiting',
    sentences: {
      byOperation: {
        list_candidates: ['List candidates'],
        get_candidate: [
          {
            text: 'Get candidate for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        create_candidate: ['Create candidate'],
        update_candidate: [
          {
            text: 'Update candidate for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        delete_candidate: [
          {
            text: 'Delete candidate for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        list_candidate_phones: [
          {
            text: 'List candidate phones for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        get_candidate_phone: [
          { text: 'Get candidate phone for', field: ['phoneIdPicker', 'phoneIdInput'], core: true },
        ],
        create_candidate_phone: [
          {
            text: 'Create candidate phone for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        update_candidate_phone: [
          {
            text: 'Update candidate phone for',
            field: ['phoneIdPicker', 'phoneIdInput'],
            core: true,
          },
        ],
        delete_candidate_phone: [
          {
            text: 'Delete candidate phone for',
            field: ['phoneIdPicker', 'phoneIdInput'],
            core: true,
          },
        ],
        list_candidate_education: [
          {
            text: 'List candidate education for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        list_candidate_experience: [
          {
            text: 'List candidate experience for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        list_candidate_skills: [
          {
            text: 'List candidate skills for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        list_candidate_attachments: [
          {
            text: 'List candidate attachments for',
            field: ['candidateNumberPicker', 'candidateNumberInput'],
            core: true,
          },
        ],
        list_requisitions: ['List requisitions'],
        get_requisition: [
          {
            text: 'Get requisition for',
            field: ['requisitionIdPicker', 'requisitionIdInput'],
            core: true,
          },
        ],
        create_requisition: ['Create requisition'],
        update_requisition: [
          {
            text: 'Update requisition for',
            field: ['requisitionIdPicker', 'requisitionIdInput'],
            core: true,
          },
        ],
        delete_requisition: [
          {
            text: 'Delete requisition for',
            field: ['requisitionIdPicker', 'requisitionIdInput'],
            core: true,
          },
        ],
        list_requisition_postings: [
          {
            text: 'List requisition postings for',
            field: ['requisitionIdPicker', 'requisitionIdInput'],
            core: true,
          },
        ],
        list_applications: ['List applications'],
        get_application: [
          {
            text: 'Get application for',
            field: ['applicationIdPicker', 'applicationIdInput'],
            core: true,
          },
        ],
        list_offers: ['List offers'],
        get_offer: [
          { text: 'Get offer for', field: ['offerIdPicker', 'offerIdInput'], core: true },
        ],
        list_interview_schedules: ['List interview schedules'],
        get_interview_schedule: [
          {
            text: 'Get interview schedule for',
            field: ['scheduleIdPicker', 'scheduleIdInput'],
            core: true,
          },
        ],
        list_requisition_templates: ['List requisition templates'],
        list_recruiting_representatives: ['List recruiting representatives'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Candidates', id: 'list_candidates' },
        { label: 'Get Candidate', id: 'get_candidate' },
        { label: 'Create Candidate', id: 'create_candidate' },
        { label: 'Update Candidate', id: 'update_candidate' },
        { label: 'Delete Candidate', id: 'delete_candidate' },
        { label: 'List Candidate Phones', id: 'list_candidate_phones' },
        { label: 'Get Candidate Phone', id: 'get_candidate_phone' },
        { label: 'Create Candidate Phone', id: 'create_candidate_phone' },
        { label: 'Update Candidate Phone', id: 'update_candidate_phone' },
        { label: 'Delete Candidate Phone', id: 'delete_candidate_phone' },
        { label: 'List Candidate Education', id: 'list_candidate_education' },
        { label: 'List Candidate Experience', id: 'list_candidate_experience' },
        { label: 'List Candidate Skills', id: 'list_candidate_skills' },
        { label: 'List Candidate Attachments', id: 'list_candidate_attachments' },
        { label: 'List Requisitions', id: 'list_requisitions' },
        { label: 'Get Requisition', id: 'get_requisition' },
        { label: 'Create Requisition', id: 'create_requisition' },
        { label: 'Update Requisition', id: 'update_requisition' },
        { label: 'Delete Requisition', id: 'delete_requisition' },
        { label: 'List Requisition Postings', id: 'list_requisition_postings' },
        { label: 'List Applications', id: 'list_applications' },
        { label: 'Get Application', id: 'get_application' },
        { label: 'List Offers', id: 'list_offers' },
        { label: 'Get Offer', id: 'get_offer' },
        { label: 'List Interview Schedules', id: 'list_interview_schedules' },
        { label: 'Get Interview Schedule', id: 'get_interview_schedule' },
        { label: 'List Requisition Templates', id: 'list_requisition_templates' },
        { label: 'List Recruiting Representatives', id: 'list_recruiting_representatives' },
      ],
      value: () => 'list_candidates',
    },
    {
      id: 'credential',
      title: 'Oracle Fusion Credential',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'oracle_fusion_recruiting',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oracle_fusion_recruiting'),
      required: true,
      placeholder: 'Select an Oracle Fusion integration user',
    },
    {
      id: 'candidateNumberPicker',
      title: 'Candidate',
      type: 'file-selector',
      canonicalParamId: 'candidateNumber',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_candidate',
          'update_candidate',
          'delete_candidate',
          'list_candidate_phones',
          'get_candidate_phone',
          'create_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
          'list_candidate_education',
          'list_candidate_experience',
          'list_candidate_skills',
          'list_candidate_attachments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_candidate',
          'update_candidate',
          'delete_candidate',
          'list_candidate_phones',
          'get_candidate_phone',
          'create_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
          'list_candidate_education',
          'list_candidate_experience',
          'list_candidate_skills',
          'list_candidate_attachments',
        ],
      },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.candidates',
      dependsOn: ['credential'],
      placeholder: 'Select candidate',
    },
    {
      id: 'candidateNumberInput',
      title: 'Candidate',
      type: 'short-input',
      canonicalParamId: 'candidateNumber',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_candidate',
          'update_candidate',
          'delete_candidate',
          'list_candidate_phones',
          'get_candidate_phone',
          'create_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
          'list_candidate_education',
          'list_candidate_experience',
          'list_candidate_skills',
          'list_candidate_attachments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_candidate',
          'update_candidate',
          'delete_candidate',
          'list_candidate_phones',
          'get_candidate_phone',
          'create_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
          'list_candidate_education',
          'list_candidate_experience',
          'list_candidate_skills',
          'list_candidate_attachments',
        ],
      },
      placeholder: 'Enter candidate identifier',
    },
    {
      id: 'phoneIdPicker',
      title: 'Candidate Phone',
      type: 'file-selector',
      canonicalParamId: 'phoneId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
        ],
      },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.phones',
      dependsOn: ['credential', 'candidateNumberPicker'],
      placeholder: 'Select candidate phone',
    },
    {
      id: 'phoneIdInput',
      title: 'Candidate Phone',
      type: 'short-input',
      canonicalParamId: 'phoneId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_candidate_phone',
          'update_candidate_phone',
          'delete_candidate_phone',
        ],
      },
      placeholder: 'Enter candidate phone identifier',
    },
    {
      id: 'requisitionIdPicker',
      title: 'Requisition',
      type: 'file-selector',
      canonicalParamId: 'requisitionId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'get_requisition',
          'update_requisition',
          'delete_requisition',
          'list_requisition_postings',
          'list_applications',
          'list_offers',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_requisition',
          'update_requisition',
          'delete_requisition',
          'list_requisition_postings',
        ],
      },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.requisitions',
      dependsOn: ['credential'],
      placeholder: 'Select requisition',
    },
    {
      id: 'requisitionIdInput',
      title: 'Requisition',
      type: 'short-input',
      canonicalParamId: 'requisitionId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_requisition',
          'update_requisition',
          'delete_requisition',
          'list_requisition_postings',
          'list_applications',
          'list_offers',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_requisition',
          'update_requisition',
          'delete_requisition',
          'list_requisition_postings',
        ],
      },
      placeholder: 'Enter requisition identifier',
    },
    {
      id: 'applicationIdPicker',
      title: 'Application',
      type: 'file-selector',
      canonicalParamId: 'applicationId',
      mode: 'basic',
      condition: { field: 'operation', value: ['get_application'] },
      required: { field: 'operation', value: ['get_application'] },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.applications',
      dependsOn: ['credential'],
      placeholder: 'Select application',
    },
    {
      id: 'applicationIdInput',
      title: 'Application',
      type: 'short-input',
      canonicalParamId: 'applicationId',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_application'] },
      required: { field: 'operation', value: ['get_application'] },
      placeholder: 'Enter application identifier',
    },
    {
      id: 'offerIdPicker',
      title: 'Offer',
      type: 'file-selector',
      canonicalParamId: 'offerId',
      mode: 'basic',
      condition: { field: 'operation', value: ['get_offer'] },
      required: { field: 'operation', value: ['get_offer'] },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.offers',
      dependsOn: ['credential'],
      placeholder: 'Select offer',
    },
    {
      id: 'offerIdInput',
      title: 'Offer',
      type: 'short-input',
      canonicalParamId: 'offerId',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_offer'] },
      required: { field: 'operation', value: ['get_offer'] },
      placeholder: 'Enter offer identifier',
    },
    {
      id: 'scheduleIdPicker',
      title: 'Interview Schedule',
      type: 'file-selector',
      canonicalParamId: 'scheduleId',
      mode: 'basic',
      condition: { field: 'operation', value: ['get_interview_schedule'] },
      required: { field: 'operation', value: ['get_interview_schedule'] },
      serviceId: 'oracle_fusion_recruiting',
      selectorKey: 'oracle_fusion_recruiting.interviewSchedules',
      dependsOn: ['credential'],
      placeholder: 'Select interview schedule',
    },
    {
      id: 'scheduleIdInput',
      title: 'Interview Schedule',
      type: 'short-input',
      canonicalParamId: 'scheduleId',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_interview_schedule'] },
      required: { field: 'operation', value: ['get_interview_schedule'] },
      placeholder: 'Enter interview schedule identifier',
    },
    {
      id: 'candidateBody',
      title: 'Candidate Fields',
      type: 'code',
      language: 'json',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      required: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      placeholder:
        '{\n  "FirstName": "Taylor",\n  "LastName": "Example",\n  "Email": "taylor@example.com"\n}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate Oracle Recruiting candidate fields using only: FirstName, LastName, MiddleNames, Email, KnownAs, Title, Suffix, PreNameAdjunct, PreviousLastName, PreferredLanguage, PreferredTimezone, CampaignOptIn, SourceMedium, SourceName. Preserve int64 IDs as decimal strings. For updates include only intended changes. Return ONLY the JSON object.',
        placeholder: 'Describe the fields to create or update',
      },
    },
    {
      id: 'phoneBody',
      title: 'Phone Fields',
      type: 'code',
      language: 'json',
      condition: {
        field: 'operation',
        value: [
          'create_candidate_phone',
          'update_candidate_phone',
        ],
      },
      required: { field: 'operation', value: ['create_candidate_phone', 'update_candidate_phone'] },
      placeholder: '{\n  "PhoneNumber": "5550100",\n  "CountryCodeNumber": "1"\n}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate Oracle Recruiting phone fields using only: PhoneNumber, CountryCodeNumber, AreaCode, LegislationCode. Preserve int64 IDs as decimal strings. For updates include only intended changes. Return ONLY the JSON object.',
        placeholder: 'Describe the fields to create or update',
      },
    },
    {
      id: 'requisitionBody',
      title: 'Requisition Fields',
      type: 'code',
      language: 'json',
      condition: { field: 'operation', value: ['create_requisition', 'update_requisition'] },
      required: { field: 'operation', value: ['create_requisition', 'update_requisition'] },
      placeholder:
        '{\n  "Title": "Software Engineer",\n  "RecruitingType": "ORA_PROFESSIONAL",\n  "HiringManagerId": "123",\n  "RecruiterId": "456",\n  "PrimaryLocationId": "789",\n  "PhaseId": "1",\n  "StateId": "21",\n  "UnlimitedOpenings": "N",\n  "NumberOfOpenings": 1\n}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate Oracle Recruiting requisition fields using only: Title, RequisitionNumber, RecruitingType, HiringManagerId, RecruiterId, PrimaryLocationId, PhaseId, StateId, UnlimitedOpenings, NumberOfOpenings, TemplateId, HiringManagerAssignmentId, RecruiterAssignmentId, BusinessUnitId, DepartmentId, JobId, JobFamilyId, PositionId, GradeId, LegalEmployerId, OrganizationId, PrimaryWorkLocationId, CandidateSelectionProcessId, WorkerType, JobType, FullTimeOrPartTime, RegularOrTemporary, WorkplaceTypeCode, BusinessJustification, ExternalContactName, ExternalContactEmail, InternalContactName, InternalContactEmail. Preserve int64 IDs as decimal strings. For updates include only intended changes. Return ONLY the JSON object.',
        placeholder: 'Describe the fields to create or update',
      },
    },
    { id: 'search', title: 'Search', type: 'short-input', condition: { field: 'operation', value: ['list_candidates', 'list_requisitions', 'list_applications', 'list_offers', 'list_interview_schedules', 'list_requisition_templates', 'list_recruiting_representatives'] }, placeholder: 'Search records' },
    { id: 'limit', title: 'Limit', type: 'short-input', mode: 'advanced', condition: { field: 'operation', value: ['list_candidates', 'list_candidate_phones', 'list_candidate_education', 'list_candidate_experience', 'list_candidate_skills', 'list_candidate_attachments', 'list_requisitions', 'list_requisition_postings', 'list_applications', 'list_offers', 'list_interview_schedules', 'list_requisition_templates', 'list_recruiting_representatives'] }, placeholder: '20 (maximum 100)' },
    { id: 'offset', title: 'Offset', type: 'short-input', mode: 'advanced', condition: { field: 'operation', value: ['list_candidates', 'list_candidate_phones', 'list_candidate_education', 'list_candidate_experience', 'list_candidate_skills', 'list_candidate_attachments', 'list_requisitions', 'list_requisition_postings', 'list_applications', 'list_offers', 'list_interview_schedules', 'list_requisition_templates', 'list_recruiting_representatives'] }, placeholder: '0' },
  ],
  tools: {
    access: [
      'oracle_fusion_recruiting_list_candidates',
      'oracle_fusion_recruiting_get_candidate',
      'oracle_fusion_recruiting_create_candidate',
      'oracle_fusion_recruiting_update_candidate',
      'oracle_fusion_recruiting_delete_candidate',
      'oracle_fusion_recruiting_list_candidate_phones',
      'oracle_fusion_recruiting_get_candidate_phone',
      'oracle_fusion_recruiting_create_candidate_phone',
      'oracle_fusion_recruiting_update_candidate_phone',
      'oracle_fusion_recruiting_delete_candidate_phone',
      'oracle_fusion_recruiting_list_candidate_education',
      'oracle_fusion_recruiting_list_candidate_experience',
      'oracle_fusion_recruiting_list_candidate_skills',
      'oracle_fusion_recruiting_list_candidate_attachments',
      'oracle_fusion_recruiting_list_requisitions',
      'oracle_fusion_recruiting_get_requisition',
      'oracle_fusion_recruiting_create_requisition',
      'oracle_fusion_recruiting_update_requisition',
      'oracle_fusion_recruiting_delete_requisition',
      'oracle_fusion_recruiting_list_requisition_postings',
      'oracle_fusion_recruiting_list_applications',
      'oracle_fusion_recruiting_get_application',
      'oracle_fusion_recruiting_list_offers',
      'oracle_fusion_recruiting_get_offer',
      'oracle_fusion_recruiting_list_interview_schedules',
      'oracle_fusion_recruiting_get_interview_schedule',
      'oracle_fusion_recruiting_list_requisition_templates',
      'oracle_fusion_recruiting_list_recruiting_representatives',
    ],
    config: {
      tool: (params) => `oracle_fusion_recruiting_${params.operation || 'list_candidates'}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const key of ['limit', 'offset']) {
          result[key] =
            params[key] === '' || params[key] == null
              ? undefined
              : typeof params[key] === 'string'
                ? Number(params[key])
                : params[key]
        }
        for (const key of ['search', 'requisitionId']) {
          if (params[key] == null || (typeof params[key] === 'string' && !params[key].trim()))
            result[key] = undefined
        }
        const bodies: Record<string, string> = {
          create_candidate: 'candidateBody',
          update_candidate: 'candidateBody',
          create_candidate_phone: 'phoneBody',
          update_candidate_phone: 'phoneBody',
          create_requisition: 'requisitionBody',
          update_requisition: 'requisitionBody',
        }
        const bodyKey = bodies[params.operation]
        if (bodyKey) {
          const value = params[bodyKey]
          result.body = typeof value === 'string' ? JSON.parse(value) : value
        }
        return result
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Saved Oracle Fusion credential' },
    candidateNumber: { type: 'string', description: 'candidateNumber' },
    phoneId: { type: 'string', description: 'phoneId' },
    requisitionId: { type: 'string', description: 'requisitionId' },
    applicationId: { type: 'string', description: 'applicationId' },
    offerId: { type: 'string', description: 'offerId' },
    scheduleId: { type: 'string', description: 'scheduleId' },
    candidateBody: { type: 'json', description: 'Documented candidate fields' },
    phoneBody: { type: 'json', description: 'Documented phone fields' },
    requisitionBody: { type: 'json', description: 'Documented requisition fields' },
    search: { type: 'string', description: 'Search text' },
    limit: { type: 'number', description: 'Page size' },
    offset: { type: 'number', description: 'Record offset' },
  },
  outputs: {
    candidates: {
      type: 'json',
      description:
        'Candidate records (candidateNumber, personId, displayName, fullName, firstName, lastName, middleNames, email, candidateType, preferredLanguage, preferredTimezone, creationDate, lastUpdateDate)',
    },
    candidate: {
      type: 'json',
      description:
        'One candidate (candidateNumber, personId, displayName, fullName, firstName, lastName, middleNames, email, candidateType, preferredLanguage, preferredTimezone, creationDate, lastUpdateDate)',
    },
    phones: {
      type: 'json',
      description:
        'Phone records (phoneId, phoneNumber, countryCodeNumber, areaCode, legislationCode, phoneType)',
    },
    phone: {
      type: 'json',
      description:
        'One phone (phoneId, phoneNumber, countryCodeNumber, areaCode, legislationCode, phoneType)',
    },
    education: {
      type: 'json',
      description:
        'Education records (educationId, degreeName, major, minor, educationalEstablishment, startDate, endDate, graduatedFlag)',
    },
    experience: {
      type: 'json',
      description:
        'Experience records (previousEmploymentId, employerName, jobTitle, startDate, endDate, currentJobFlag, department)',
    },
    skills: {
      type: 'json',
      description:
        'Skill records (skillId, skill, description, yearsOfExperience, dateAchieved, speciality)',
    },
    attachments: {
      type: 'json',
      description:
        'Attachment records (attachedDocumentId, fileName, title, description, uploadedFileContentType, uploadedFileLength, categoryName, creationDate, lastUpdateDate)',
    },
    requisitions: {
      type: 'json',
      description:
        'Requisition records (requisitionId, requisitionNumber, title, recruitingType, phaseId, phaseName, stateId, stateName, hiringManagerId, recruiterId, primaryLocationId, businessUnitId, departmentId, jobId, numberOfOpenings, unlimitedOpenings, creationDate, lastUpdateDate)',
    },
    requisition: {
      type: 'json',
      description:
        'One requisition (requisitionId, requisitionNumber, title, recruitingType, phaseId, phaseName, stateId, stateName, hiringManagerId, recruiterId, primaryLocationId, businessUnitId, departmentId, jobId, numberOfOpenings, unlimitedOpenings, creationDate, lastUpdateDate)',
    },
    postings: {
      type: 'json',
      description:
        'Posting records (publishedJobId, postingStatus, visibility, startDate, endDate, timeZone)',
    },
    applications: {
      type: 'json',
      description:
        'Application records (jobApplicationId, candidateName, candidatePersonId, requisitionId, requisitionNumber, phaseId, phaseName, stateId, stateName, confirmedFlag, disqualifiedFlag, internalFlag, jobApplicationDate, lastUpdateDate)',
    },
    application: {
      type: 'json',
      description:
        'One application (jobApplicationId, candidateName, candidatePersonId, requisitionId, requisitionNumber, phaseId, phaseName, stateId, stateName, confirmedFlag, disqualifiedFlag, internalFlag, jobApplicationDate, lastUpdateDate)',
    },
    offers: {
      type: 'json',
      description:
        'Offer records (offerId, offerName, jobApplicationId, candidatePersonId, requisitionId, phaseId, phaseName, stateId, stateName, hireDate, expirationDate, lastUpdateDate)',
    },
    offer: {
      type: 'json',
      description:
        'One offer (offerId, offerName, jobApplicationId, candidatePersonId, requisitionId, phaseId, phaseName, stateId, stateName, hireDate, expirationDate, lastUpdateDate)',
    },
    interviewSchedules: {
      type: 'json',
      description:
        'Interview Schedule records (scheduleId, scheduleCode, scheduleTitle, scheduleType, interviewType, interviewTypeMeaning, status)',
    },
    interviewSchedule: {
      type: 'json',
      description:
        'One interview schedule (scheduleId, scheduleCode, scheduleTitle, scheduleType, interviewType, interviewTypeMeaning, status)',
    },
    requisitionTemplates: {
      type: 'json',
      description:
        'Requisition Template records (requisitionId, requisitionNumber, name, title, requisitionNameWithNumber)',
    },
    representatives: {
      type: 'json',
      description:
        'Representative records (personId, personNumber, displayName, assignmentId, assignmentNumber, workEmailAddress)',
    },
    deleted: { type: 'boolean', description: 'Whether Oracle confirmed deletion' },
    count: { type: 'number', description: 'Records in this page' },
    hasMore: { type: 'boolean', description: 'Whether more records exist' },
    limit: { type: 'number', description: 'Page size reported by Oracle' },
    offset: { type: 'number', description: 'Page offset' },
    nextOffset: { type: 'number', description: 'Next page offset when more records exist' },
    totalResults: { type: 'number', description: 'Estimated total when returned by Oracle' },
  },
}

export const OracleFusionRecruitingBlockMeta = {
  tags: ['automation'],
  url: 'https://www.oracle.com/human-capital-management/recruiting/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Review candidate profiles',
      prompt:
        'When a candidate number is provided, read the candidate, education, experience, and skills, then return a factual profile summary without ranking candidates.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track requisition status',
      prompt:
        'On a scheduled run, list one page of requisitions and summarize titles, phases, states, and openings with continuation metadata.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track application progress',
      prompt:
        'When a requisition ID is provided, list its applications and summarize their current phases and states.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review offer deadlines',
      prompt:
        'On a scheduled run, list one page of offers and report expiration dates and current states without changing offers.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect interview schedules',
      prompt:
        'When asked about available interview schedules, list schedule lookup records and report their titles, types, and status. Do not claim appointment availability.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review published jobs',
      prompt:
        'When a requisition is selected, list its published jobs and summarize posting visibility, status, and dates.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare requisition creation',
      prompt:
        'When a hiring request provides the required Oracle IDs, inspect requisition templates and representatives, create the specified requisition, and return its identifier and status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'review-candidate-profiles',
      description:
        'When a candidate number is provided, read the candidate, education, experience, and skills, then return a factual profile summary without ranking candidates.',
      content:
        '# Review candidate profiles\n\nWhen a candidate number is provided, read the candidate, education, experience, and skills, then return a factual profile summary without ranking candidates.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. When a candidate number is provided, read the candidate, education, experience, and skills, then return a factual profile summary without ranking candidates.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
    {
      name: 'track-requisition-status',
      description:
        'On a scheduled run, list one page of requisitions and summarize titles, phases, states, and openings with continuation metadata.',
      content:
        '# Track requisition status\n\nOn a scheduled run, list one page of requisitions and summarize titles, phases, states, and openings with continuation metadata.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. On a scheduled run, list one page of requisitions and summarize titles, phases, states, and openings with continuation metadata.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
    {
      name: 'track-application-progress',
      description:
        'When a requisition ID is provided, list its applications and summarize their current phases and states.',
      content:
        '# Track application progress\n\nWhen a requisition ID is provided, list its applications and summarize their current phases and states.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. When a requisition ID is provided, list its applications and summarize their current phases and states.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
    {
      name: 'review-offer-deadlines',
      description:
        'On a scheduled run, list one page of offers and report expiration dates and current states without changing offers.',
      content:
        '# Review offer deadlines\n\nOn a scheduled run, list one page of offers and report expiration dates and current states without changing offers.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. On a scheduled run, list one page of offers and report expiration dates and current states without changing offers.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
    {
      name: 'inspect-interview-schedules',
      description:
        'When asked about available interview schedules, list schedule lookup records and report their titles, types, and status. Do not claim appointment availability.',
      content:
        '# Inspect interview schedules\n\nWhen asked about available interview schedules, list schedule lookup records and report their titles, types, and status. Do not claim appointment availability.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. When asked about available interview schedules, list schedule lookup records and report their titles, types, and status. Do not claim appointment availability.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
    {
      name: 'review-published-jobs',
      description:
        'When a requisition is selected, list its published jobs and summarize posting visibility, status, and dates.',
      content:
        '# Review published jobs\n\nWhen a requisition is selected, list its published jobs and summarize posting visibility, status, and dates.\n\n## Steps\n1. Select the saved Oracle Fusion integration-user credential.\n2. When a requisition is selected, list its published jobs and summarize posting visibility, status, and dates.\n3. Return only supported fields and identify any remaining pages.\n\n## Output\nProvide a factual summary with resource identifiers and pagination state. Respect Oracle access errors; do not infer missing information.\n\nSource: https://www.oracle.com/human-capital-management/recruiting/',
    },
  ],
} as const satisfies BlockMeta
