import { describe, expect, it } from 'vitest'
import * as projectors from '@/lib/internal/oracle-fusion-hcm/projectors'
import * as schemas from '@/lib/internal/oracle-fusion-hcm/schema'
import {
  oracleFusionHcmGetWorkerBodySchema,
  oracleFusionHcmListAbsencesBodySchema,
  oracleFusionHcmListJobsBodySchema,
} from '@/lib/internal/oracle-fusion-hcm/schema'
import * as outputs from '@/tools/oracle_fusion_hcm/types'

const TEST_ACCESS_TOKEN = 'test-access-token'
const auth = {
  instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
  accessToken: TEST_ACCESS_TOKEN,
}

describe('Oracle Fusion HCM input validation', () => {
  it('accepts exact positive int64 IDs and rejects invalid identifiers', () => {
    expect(
      oracleFusionHcmGetWorkerBodySchema.safeParse({
        ...auth,
        personId: '9223372036854775807',
      }).success
    ).toBe(true)
    expect(oracleFusionHcmGetWorkerBodySchema.parse({ ...auth, personId: ' 123 ' }).personId).toBe(
      '123'
    )
    for (const personId of ['0', '-1', '1.5', 'abc', '9223372036854775808']) {
      expect(oracleFusionHcmGetWorkerBodySchema.safeParse({ ...auth, personId }).success).toBe(
        false
      )
    }
  })

  it.each([
    ['overlong search', { search: 'x'.repeat(201) }],
    ['oversized page', { limit: 101 }],
    ['negative offset', { offset: -1 }],
    ['invalid calendar date', { effectiveDate: '2026-02-30' }],
  ])('rejects %s independently', (_case, invalidInput) => {
    expect(oracleFusionHcmListJobsBodySchema.safeParse({ ...auth, ...invalidInput }).success).toBe(
      false
    )
  })

  it('accepts bounded search, pagination, and a real calendar date', () => {
    expect(
      oracleFusionHcmListJobsBodySchema.safeParse({
        ...auth,
        search: 'Engineer',
        limit: 100,
        offset: 0,
        effectiveDate: '2026-02-28',
      }).success
    ).toBe(true)
  })

  it('requires absence dates as a complete ordered pair with a type', () => {
    for (const incompleteDates of [{ startDate: '2026-02-01' }, { endDate: '2026-02-02' }]) {
      expect(
        oracleFusionHcmListAbsencesBodySchema.safeParse({
          ...auth,
          personId: '1',
          absenceTypeId: '2',
          ...incompleteDates,
        }).success
      ).toBe(false)
    }
    expect(
      oracleFusionHcmListAbsencesBodySchema.safeParse({
        ...auth,
        personId: '1',
        absenceTypeId: '2',
        startDate: '2026-02-02',
        endDate: '2026-02-01',
      }).success
    ).toBe(false)
    expect(
      oracleFusionHcmListAbsencesBodySchema.safeParse({
        ...auth,
        personId: '1',
        startDate: '2026-02-01',
        endDate: '2026-02-02',
      }).success
    ).toBe(false)
    expect(
      oracleFusionHcmListAbsencesBodySchema.safeParse({
        ...auth,
        personId: '1',
        absenceTypeId: '2',
        startDate: '2026-02-01',
        endDate: '2026-02-02',
      }).success
    ).toBe(true)
  })

  it('requires only the executor-injected credential bundle', () => {
    expect(oracleFusionHcmListJobsBodySchema.safeParse(auth).success).toBe(true)
    expect(
      oracleFusionHcmListJobsBodySchema.safeParse({
        tenantUrl: auth.instanceUrl,
        username: 'reader',
        password: 'secret',
      }).success
    ).toBe(false)
  })
})

// Fixtures use the corresponding Oracle REST resource's documented response fields.
describe('Oracle Fusion HCM projection contracts', () => {
  const cases = [
    {
      name: 'PayrollRelationship',
      project: projectors.projectPayrollRelationship,
      schema: schemas.oracleFusionHcmPayrollRelationshipSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_RELATIONSHIP_OUTPUT_PROPERTIES,
      fixture: {
        PayrollRelationshipId: '9223372036854775807',
        PersonNumber: '0007',
        Country: 'GB',
        EffectiveStartDate: '2020-01-01',
      },
    },
    {
      name: 'PayrollAssignment',
      project: projectors.projectPayrollAssignment,
      schema: schemas.oracleFusionHcmPayrollAssignmentSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_ASSIGNMENT_OUTPUT_PROPERTIES,
      fixture: {
        RelationshipGroupId: '9007199254740993',
        AssignmentId: '9007199254740995',
        AssignmentNumber: 'E7',
        TimeCardRequired: 'Y',
      },
    },
    {
      name: 'AssignedPayroll',
      project: projectors.projectAssignedPayroll,
      schema: schemas.oracleFusionHcmAssignedPayrollSchema,
      properties: outputs.ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES,
      fixture: {
        AssignedPayrollId: '31',
        PayrollId: '32',
        PayrollName: 'Monthly',
        Lsed: null,
        TimeCardRequired: 'N',
      },
    },
    {
      name: 'PayrollDefinition',
      project: projectors.projectPayrollDefinition,
      schema: schemas.oracleFusionHcmPayrollDefinitionSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_DEFINITION_OUTPUT_PROPERTIES,
      fixture: { PayrollId: '32', PayrollName: 'Monthly', PeriodType: 'Calendar Month' },
    },
    {
      name: 'PayrollTimePeriod',
      project: projectors.projectPayrollTimePeriod,
      schema: schemas.oracleFusionHcmPayrollTimePeriodSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_TIME_PERIOD_OUTPUT_PROPERTIES,
      fixture: { TimePeriodId: '33', PayrollId: '32', PeriodNumber: 8, PeriodName: 'August' },
    },
    {
      name: 'PayrollElementDefinition',
      project: projectors.projectPayrollElementDefinition,
      schema: schemas.oracleFusionHcmPayrollElementDefinitionSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_ELEMENT_DEFINITION_OUTPUT_PROPERTIES,
      fixture: {
        ElementTypeId: '34',
        ElementName: 'Bonus',
        UseAtAssignmentLevel: 'Y',
        PersonId: null,
      },
    },
    {
      name: 'PayrollInputValue',
      project: projectors.projectPayrollInputValue,
      schema: schemas.oracleFusionHcmPayrollInputValueSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_INPUT_VALUE_OUTPUT_PROPERTIES,
      fixture: { InputValueId: '35', ElementTypeId: '34', InputValueName: 'Amount', UOM: 'M' },
    },
    {
      name: 'ElementEntry',
      project: projectors.projectElementEntry,
      schema: schemas.oracleFusionHcmElementEntrySchema,
      properties: outputs.ORACLE_FUSION_HCM_ELEMENT_ENTRY_OUTPUT_PROPERTIES,
      fixture: {
        ElementEntryId: '36',
        PersonId: '7',
        PersonNumber: '0007',
        AssignmentId: null,
        ElementName: 'Bonus',
        EntryType: 'E',
      },
    },
    {
      name: 'ElementEntryValue',
      project: projectors.projectElementEntryValue,
      schema: schemas.oracleFusionHcmElementEntryValueSchema,
      properties: outputs.ORACLE_FUSION_HCM_ELEMENT_ENTRY_VALUE_OUTPUT_PROPERTIES,
      fixture: {
        ElementEntryValueId: '37',
        InputValueId: '35',
        ScreenEntryValue: '123456789012345.67',
        MandatoryFlag: true,
        UserEnterableFlag: false,
      },
    },
    {
      name: 'PersonProcessResult',
      project: projectors.projectPersonProcessResult,
      schema: schemas.oracleFusionHcmPersonProcessResultSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERSON_PROCESS_RESULT_OUTPUT_PROPERTIES,
      fixture: {
        ObjectActionId: '38',
        PayrollRelationshipId: '39',
        PersonNumber: '0007',
        Status: 'Completed',
        ProcessDate: '2020-01-31',
      },
    },
    {
      name: 'PayrollRunResult',
      project: projectors.projectPayrollRunResult,
      schema: schemas.oracleFusionHcmPayrollRunResultSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_RUN_RESULT_OUTPUT_PROPERTIES,
      fixture: {
        RunResultId: '40',
        InputValueId: '35',
        ResultValue: '123456789012345.6700',
        Uom: 'M',
      },
    },
    {
      name: 'PayrollBalance',
      project: projectors.projectPayrollBalance,
      schema: schemas.oracleFusionHcmPayrollBalanceSchema,
      properties: outputs.ORACLE_FUSION_HCM_PAYROLL_BALANCE_OUTPUT_PROPERTIES,
      fixture: {
        BalanceTypeId: '41',
        BalanceName: 'Gross Earnings',
        DimensionName: 'Relationship Period to Date',
        Value1: '123.4500',
        Value2: null,
        Value10: '0',
        TotalValue1: '123.4500',
        DefbalId1: '9007199254740993',
      },
    },
    {
      name: 'Salary',
      project: projectors.projectSalary,
      schema: schemas.oracleFusionHcmSalarySchema,
      properties: outputs.ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES,
      fixture: {
        SalaryId: '42',
        AssignmentId: '9007199254740993',
        SalaryBasisId: '43',
        SalaryAmount: 1000.5,
        PendingTransactionExists: 'N',
        SalaryTransactionStatus: null,
        MultipleComponents: 'N',
      },
    },
    {
      name: 'SalaryBasis',
      project: projectors.projectSalaryBasis,
      schema: schemas.oracleFusionHcmSalaryBasisSchema,
      properties: outputs.ORACLE_FUSION_HCM_SALARY_BASIS_OUTPUT_PROPERTIES,
      fixture: {
        SalaryBasisId: '43',
        SalaryBasisName: 'Annual',
        SalaryBasisType: 'U',
        SalaryAmountScale: 2,
        GradeRateId: null,
      },
    },
    {
      name: 'StandardSalaryComponent',
      project: projectors.projectStandardSalaryComponent,
      schema: schemas.oracleFusionHcmStandardSalaryComponentSchema,
      properties: outputs.ORACLE_FUSION_HCM_STANDARD_SALARY_COMPONENT_OUTPUT_PROPERTIES,
      fixture: {
        SalaryComponentId: '44',
        SalaryId: '42',
        AdjustmentAmount: 100,
        AdjustmentPercentage: 2.5,
      },
    },
    {
      name: 'SimpleSalaryComponent',
      project: projectors.projectSimpleSalaryComponent,
      schema: schemas.oracleFusionHcmSimpleSalaryComponentSchema,
      properties: outputs.ORACLE_FUSION_HCM_SIMPLE_SALARY_COMPONENT_OUTPUT_PROPERTIES,
      fixture: {
        SimpleSalaryCompntId: '45',
        SalaryId: '42',
        Amount: 100,
        UserSelectedComponent: 'Y',
        OverallSalaryAffect: 'Y',
      },
    },
    {
      name: 'RateSalaryComponent',
      project: projectors.projectRateSalaryComponent,
      schema: schemas.oracleFusionHcmRateSalaryComponentSchema,
      properties: outputs.ORACLE_FUSION_HCM_RATE_SALARY_COMPONENT_OUTPUT_PROPERTIES,
      fixture: {
        SalaryPayComponentId: '46',
        SalaryId: '42',
        RateAmount: 100,
        RateOverallSalaryFlag: true,
      },
    },
    {
      name: 'GradeRateValue',
      project: projectors.projectGradeRateValue,
      schema: schemas.oracleFusionHcmGradeRateValueSchema,
      properties: outputs.ORACLE_FUSION_HCM_GRADE_RATE_VALUE_OUTPUT_PROPERTIES,
      fixture: {
        RateValueId: '47',
        GradeId: '48',
        MinimumAmount: 1000,
        MidValueAmount: 2000,
        MaximumAmount: null,
      },
    },
    {
      name: 'GoalPlan',
      project: projectors.projectGoalPlan,
      schema: schemas.oracleFusionHcmGoalPlanSchema,
      properties: outputs.ORACLE_FUSION_HCM_GOAL_PLAN_OUTPUT_PROPERTIES,
      fixture: {
        GoalPlanId: '49',
        ReviewPeriodId: '50',
        GoalPlanName: '2026 Goals',
        EnableWeightingFlag: true,
      },
    },
    {
      name: 'PerformanceGoal',
      project: projectors.projectPerformanceGoal,
      schema: schemas.oracleFusionHcmPerformanceGoalSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERFORMANCE_GOAL_OUTPUT_PROPERTIES,
      fixture: { GoalId: '51', PersonId: '7', PercentComplete: '25', Status: 'IN_PROGRESS' },
    },
    {
      name: 'DevelopmentGoal',
      project: projectors.projectDevelopmentGoal,
      schema: schemas.oracleFusionHcmDevelopmentGoalSchema,
      properties: outputs.ORACLE_FUSION_HCM_DEVELOPMENT_GOAL_OUTPUT_PROPERTIES,
      fixture: { GoalId: '52', PersonId: '7', PercentComplete: '0', PrivateFlag: false },
    },
    {
      name: 'PerformanceDocument',
      project: projectors.projectPerformanceDocument,
      schema: schemas.oracleFusionHcmPerformanceDocumentSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_OUTPUT_PROPERTIES,
      fixture: {
        EvaluationId: '53',
        PersonId: '7',
        ReviewPeriodId: '50',
        PerformanceDocumentName: 'Annual Review',
        EvalStatus: 'INPROGRESS',
      },
    },
    {
      name: 'PerformanceDocumentRole',
      project: projectors.projectPerformanceDocumentRole,
      schema: schemas.oracleFusionHcmPerformanceDocumentRoleSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_ROLE_OUTPUT_PROPERTIES,
      fixture: {
        EvalRoleId: '54',
        RoleTypeCode: 'MANAGER',
        MinimumNumberPcpns: 1,
        MatrixParticipantFlag: false,
      },
    },
    {
      name: 'PerformanceDocumentParticipant',
      project: projectors.projectPerformanceDocumentParticipant,
      schema: schemas.oracleFusionHcmPerformanceDocumentParticipantSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_PARTICIPANT_OUTPUT_PROPERTIES,
      fixture: {
        EvalParticipantId: '55',
        EvalRoleId: '54',
        PersonId: '7',
        ParticipationStatusCode: 'OPEN',
      },
    },
    {
      name: 'PerformanceDocumentTask',
      project: projectors.projectPerformanceDocumentTask,
      schema: schemas.oracleFusionHcmPerformanceDocumentTaskSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_TASK_OUTPUT_PROPERTIES,
      fixture: {
        EvalStepId: '56',
        StepCode: 'MGREVAL',
        TaskName: 'Manager Evaluation',
        TaskStatus: 'Not started',
      },
    },
    {
      name: 'TalentProfile',
      project: projectors.projectTalentProfile,
      schema: schemas.oracleFusionHcmTalentProfileSchema,
      properties: outputs.ORACLE_FUSION_HCM_TALENT_PROFILE_OUTPUT_PROPERTIES,
      fixture: { ProfileId: '57', PersonId: '7', ProfileCode: 'P7', DisplayName: 'Example Worker' },
    },
    {
      name: 'TalentProfileSection',
      project: projectors.projectTalentProfileSection,
      schema: schemas.oracleFusionHcmTalentProfileSectionSchema,
      properties: outputs.ORACLE_FUSION_HCM_TALENT_PROFILE_SECTION_OUTPUT_PROPERTIES,
      fixture: {
        ProfileSectionId: '58',
        SectionId: '59',
        SectionName: 'Skills',
        SectionContext: 'SKILL',
      },
    },
    {
      name: 'TalentProfileSkill',
      project: projectors.projectTalentProfileSkill,
      schema: schemas.oracleFusionHcmTalentProfileSkillSchema,
      properties: outputs.ORACLE_FUSION_HCM_TALENT_PROFILE_SKILL_OUTPUT_PROPERTIES,
      fixture: {
        SkillId: '60',
        ProfileId: '57',
        SectionId: '59',
        Skill: 'Communication',
        YearsOfExperience: 3,
      },
    },
    {
      name: 'TalentProfileCertification',
      project: projectors.projectTalentProfileCertification,
      schema: schemas.oracleFusionHcmTalentProfileCertificationSchema,
      properties: outputs.ORACLE_FUSION_HCM_TALENT_PROFILE_CERTIFICATION_OUTPUT_PROPERTIES,
      fixture: {
        CertificationId: '61',
        ProfileId: '57',
        SectionId: '59',
        Title: 'Certificate',
        Verified: 'Y',
      },
    },
    {
      name: 'TimeRecord',
      project: projectors.projectTimeRecord,
      schema: schemas.oracleFusionHcmTimeRecordSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_RECORD_OUTPUT_PROPERTIES,
      fixture: {
        timeRecordId: '9007199254740993',
        timeRecordVersion: 2,
        personNumber: '0007',
        measure: 8,
        unitOfMeasure: 'HR',
      },
    },
    {
      name: 'TimeCard',
      project: projectors.projectTimeCard,
      schema: schemas.oracleFusionHcmTimeCardSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_CARD_OUTPUT_PROPERTIES,
      fixture: {
        timeRecordGroupId: '63',
        timeRecordGroupVersion: 1,
        personId: '7',
        totalHours: 40,
        groupType: 'Processed Timecard',
      },
    },
    {
      name: 'TimeAttribute',
      project: projectors.projectTimeAttribute,
      schema: schemas.oracleFusionHcmTimeAttributeSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_ATTRIBUTE_OUTPUT_PROPERTIES,
      fixture: {
        tmAtrbFldId: '64',
        tmAtrbFldUsageId: '65',
        attributeName: 'PayrollTimeType',
        contextCode: 'ORA_HWM_TIME_RECORDS_REST',
      },
    },
    {
      name: 'TimeAttributeDataSource',
      project: projectors.projectTimeAttributeDataSource,
      schema: schemas.oracleFusionHcmTimeAttributeDataSourceSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_ATTRIBUTE_DATA_SOURCE_OUTPUT_PROPERTIES,
      fixture: {
        dataSourceUsageId: '66',
        dataSourceUsageCode: 'PayrollTimeType',
        tmAtrbFldId: '64',
      },
    },
    {
      name: 'TimeAttributeCriteriaBind',
      project: projectors.projectTimeAttributeCriteriaBind,
      schema: schemas.oracleFusionHcmTimeAttributeCriteriaBindSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_ATTRIBUTE_CRITERIA_BIND_OUTPUT_PROPERTIES,
      fixture: { bindName: 'pAssignmentId', criteriaName: 'AssignmentId', dataType: 'NUMBER' },
    },
    {
      name: 'TimeAttributeValue',
      project: projectors.projectTimeAttributeValue,
      schema: schemas.oracleFusionHcmTimeAttributeValueSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_ATTRIBUTE_VALUE_OUTPUT_PROPERTIES,
      fixture: { value: 'REG', displayValue: 'Regular' },
    },
    {
      name: 'TimeRecordRequest',
      project: projectors.projectTimeRecordRequest,
      schema: schemas.oracleFusionHcmTimeRecordRequestSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES,
      fixture: { timeRecordEventRequestId: '67', processInline: 'N', processMode: 'TIME_ENTER' },
    },
    {
      name: 'TimeRecordRequestEvent',
      project: projectors.projectTimeRecordRequestEvent,
      schema: schemas.oracleFusionHcmTimeRecordRequestEventSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_EVENT_OUTPUT_PROPERTIES,
      fixture: {
        timeRecordEventId: '68',
        timeRecordEventRequestId: '67',
        timeRecordId: null,
        timeRecordVersion: null,
        eventStatus: 'New',
        eventStatusValue: 0,
        reporterId: '0007',
        personId: '7',
      },
    },
    {
      name: 'TimeRecordEventMessage',
      project: projectors.projectTimeRecordEventMessage,
      schema: schemas.oracleFusionHcmTimeRecordEventMessageSchema,
      properties: outputs.ORACLE_FUSION_HCM_TIME_RECORD_EVENT_MESSAGE_OUTPUT_PROPERTIES,
      fixture: {
        timeRecordEventMessageId: '69',
        timeRecordId: '62',
        timeBldgBlkVersion: 2,
        messageId: null,
        messageName: 'HWM_VALIDATION',
        allowException: 'N',
      },
    },
    {
      name: 'Worker',
      project: projectors.projectWorker,
      schema: schemas.oracleFusionHcmWorkerSchema,
      properties: outputs.ORACLE_FUSION_HCM_WORKER_OUTPUT_PROPERTIES,
      fixture: {
        PersonId: '9223372036854775807',
        DisplayName: 'Ada',
        WorkEmail: 'ada@example.com',
      },
    },
    {
      name: 'Assignment',
      project: projectors.projectAssignment,
      schema: schemas.oracleFusionHcmAssignmentSchema,
      properties: outputs.ORACLE_FUSION_HCM_ASSIGNMENT_OUTPUT_PROPERTIES,
      fixture: {
        AssignmentId: '2',
        AssignmentNumber: 'A2',
        PrimaryFlag: 'Y',
        PrimaryAssignmentFlag: false,
      },
    },
    {
      name: 'Manager',
      project: projectors.projectManager,
      schema: schemas.oracleFusionHcmManagerSchema,
      properties: outputs.ORACLE_FUSION_HCM_MANAGER_OUTPUT_PROPERTIES,
      fixture: {
        AssignmentSupervisorId: '3',
        ManagerPersonId: '1',
        ManagerAssignmentId: '2',
        ManagerType: 'LINE_MANAGER',
      },
    },
    {
      name: 'DirectReport',
      project: projectors.projectDirectReport,
      schema: schemas.oracleFusionHcmDirectReportSchema,
      properties: outputs.ORACLE_FUSION_HCM_DIRECT_REPORT_OUTPUT_PROPERTIES,
      fixture: { PersonId: null, AssignmentId: null, DirectReportsCount: 2, AllReportsCount: 3 },
    },
    {
      name: 'Absence',
      project: projectors.projectAbsence,
      schema: schemas.oracleFusionHcmAbsenceSchema,
      properties: outputs.ORACLE_FUSION_HCM_ABSENCE_OUTPUT_PROPERTIES,
      fixture: {
        personAbsenceEntryId: '4',
        personId: '1',
        duration: 2.5,
        absenceDispStatusMeaning: 'Approved',
        openEndedFlag: false,
      },
    },
    {
      name: 'AbsenceType',
      project: projectors.projectAbsenceType,
      schema: schemas.oracleFusionHcmAbsenceTypeSchema,
      properties: outputs.ORACLE_FUSION_HCM_ABSENCE_TYPE_OUTPUT_PROPERTIES,
      fixture: {
        AbsenceTypeId: '5',
        AbsenceTypeName: 'Vacation',
        DurationUOMCode: 'D',
        EmployerId: '6',
      },
    },
    {
      name: 'Job',
      project: projectors.projectJob,
      schema: schemas.oracleFusionHcmJobSchema,
      properties: outputs.ORACLE_FUSION_HCM_JOB_OUTPUT_PROPERTIES,
      fixture: { JobId: '7', Name: 'Engineer', JobFamilyId: '8' },
    },
    {
      name: 'JobFamily',
      project: projectors.projectJobFamily,
      schema: schemas.oracleFusionHcmJobFamilySchema,
      properties: outputs.ORACLE_FUSION_HCM_JOB_FAMILY_OUTPUT_PROPERTIES,
      fixture: { JobFamilyId: '8', JobFamilyName: 'Engineering' },
    },
    {
      name: 'Department',
      project: projectors.projectDepartment,
      schema: schemas.oracleFusionHcmDepartmentSchema,
      properties: outputs.ORACLE_FUSION_HCM_DEPARTMENT_OUTPUT_PROPERTIES,
      fixture: { OrganizationId: '9', Name: 'Engineering', ClassificationCode: 'DEPARTMENT' },
    },
    {
      name: 'Location',
      project: projectors.projectLocation,
      schema: schemas.oracleFusionHcmLocationSchema,
      properties: outputs.ORACLE_FUSION_HCM_LOCATION_OUTPUT_PROPERTIES,
      fixture: { LocationId: '10', LocationName: 'Seattle', Country: 'US' },
    },
    {
      name: 'Position',
      project: projectors.projectPosition,
      schema: schemas.oracleFusionHcmPositionSchema,
      properties: outputs.ORACLE_FUSION_HCM_POSITION_OUTPUT_PROPERTIES,
      fixture: { PositionId: '11', Name: 'Engineer', DepartmentId: '9' },
    },
    {
      name: 'BusinessUnit',
      project: projectors.projectBusinessUnit,
      schema: schemas.oracleFusionHcmBusinessUnitSchema,
      properties: outputs.ORACLE_FUSION_HCM_BUSINESS_UNIT_OUTPUT_PROPERTIES,
      fixture: { BusinessUnitId: '12', Name: 'Operations' },
    },
    {
      name: 'LegalEmployer',
      project: projectors.projectLegalEmployer,
      schema: schemas.oracleFusionHcmLegalEmployerSchema,
      properties: outputs.ORACLE_FUSION_HCM_LEGAL_EMPLOYER_OUTPUT_PROPERTIES,
      fixture: { OrganizationId: '13', Name: 'Acme', LegislationCode: 'US' },
    },
    {
      name: 'Grade',
      project: projectors.projectGrade,
      schema: schemas.oracleFusionHcmGradeSchema,
      properties: outputs.ORACLE_FUSION_HCM_GRADE_OUTPUT_PROPERTIES,
      fixture: { GradeId: '14', GradeName: 'G7', SetId: '15' },
    },
    {
      name: 'PersonType',
      project: projectors.projectPersonType,
      schema: schemas.oracleFusionHcmPersonTypeSchema,
      properties: outputs.ORACLE_FUSION_HCM_PERSON_TYPE_OUTPUT_PROPERTIES,
      fixture: {
        PersonTypeId: '16',
        UserPersonType: 'Employee',
        ActiveFlag: 'Y',
        DefaultFlag: 'N',
      },
    },
  ]

  it.each(cases)(
    '$name keeps runtime projections, schemas, and downstream outputs aligned',
    ({ project, schema, properties, fixture }) => {
      const result = project({
        ...fixture,
        Comments: 'private narrative',
        MedicalDetails: 'private medical detail',
        links: [{ rel: 'self', href: 'https://private.example.com' }],
      })
      expect(schema.parse(result)).toEqual(result)
      expect(Object.keys(result).sort()).toEqual(Object.keys(properties).sort())
      for (const sensitiveValue of [
        'private narrative',
        'private medical detail',
        'https://private.example.com',
      ]) {
        expect(JSON.stringify(result)).not.toContain(sensitiveValue)
      }
    }
  )
})

describe('Oracle Fusion HCM payroll and time input contracts', () => {
  const salary = {
    ...auth,
    assignmentId: '9007199254740993',
    salaryBasisId: '3',
    salaryAmount: 1250.5,
    dateFrom: '2026-01-01',
    dateTo: '4712-12-31',
  }

  it('requires salary basis, amount, and an ordered effective interval', () => {
    expect(schemas.oracleFusionHcmCreateSalaryBodySchema.parse(salary).assignmentId).toBe('9007199254740993')
    for (const change of [{ assignmentId: 9007199254740992 }, { salaryBasisId: '' }, { salaryAmount: -1 }, { dateTo: '2025-12-31' }, { dateFrom: '2026-02-30' }]) {
      expect(schemas.oracleFusionHcmCreateSalaryBodySchema.safeParse({ ...salary, ...change }).success).toBe(false)
    }
  })

  it('validates each element input value without rounding identifiers or admitting extra fields', () => {
    const entry = { ...auth, personId: '1', elementTypeId: '2', elementName: 'Bonus', creatorType: 'F', entryType: 'E', effectiveStartDate: '2026-01-01', effectiveEndDate: '4712-12-31', entryValues: [{ inputValueId: '9223372036854775807', screenEntryValue: '123456789012345.67' }] }
    expect(schemas.oracleFusionHcmCreateElementEntryBodySchema.parse(entry).entryValues).toEqual(entry.entryValues)
    for (const entryValues of [[], [{ inputValueId: 123, screenEntryValue: '1' }], [{ inputValueId: '2', screenEntryValue: '1', arbitraryAction: 'execute' }], Array.from({ length: 101 }, () => entry.entryValues[0])]) {
      expect(schemas.oracleFusionHcmCreateElementEntryBodySchema.safeParse({ ...entry, entryValues }).success).toBe(false)
    }
    expect(schemas.oracleFusionHcmUpdateElementEntryValueBodySchema.parse({ ...auth, elementEntryId: '1', elementEntryValueId: '2', effectiveDate: '2026-01-01', rangeMode: 'CORRECTION', screenEntryValue: null }).screenEntryValue).toBeNull()
  })

  it('requires explicit correction/update semantics and an actual assigned-payroll change', () => {
    const input = { ...auth, payrollRelationshipId: '1', payrollAssignmentId: '2', assignedPayrollId: '3', effectiveDate: '2026-01-01', rangeMode: 'CORRECTION' }
    expect(schemas.oracleFusionHcmUpdateAssignedPayrollBodySchema.safeParse(input).success).toBe(false)
    expect(schemas.oracleFusionHcmUpdateAssignedPayrollBodySchema.safeParse({ ...input, payrollId: '4' }).success).toBe(false)
    expect(schemas.oracleFusionHcmUpdateAssignedPayrollBodySchema.safeParse({ ...input, timeCardRequired: 'Y' }).success).toBe(true)
    expect(schemas.oracleFusionHcmUpdateAssignedPayrollBodySchema.safeParse({ ...input, timeCardRequired: 'Y', rangeMode: 'ZAP' }).success).toBe(false)
  })

  it('accepts documented time combinations and partial updates without inventing quantity dates', () => {
    const range = { ...auth, personNumber: '0007', startTime: '2026-01-01T09:00:00-05:00', stopTime: '2026-01-01T17:00:00-05:00' }
    expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.parse(range).processMode).toBe('TIME_ENTER')
    expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.safeParse({ ...auth, personNumber: '0007', measure: 8, referenceDate: '2026-01-01' }).success).toBe(true)
    expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.safeParse({ ...range, measure: 8 }).success).toBe(true)
    expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.safeParse({ ...range, referenceDate: '2026-01-01' }).success).toBe(true)
    expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.safeParse({ ...auth, personNumber: '0007', measure: 8 }).success).toBe(true)
    for (const change of [{ stopTime: undefined }, { stopTime: range.startTime }, { startTime: '2026-01-01T09:00:00' }, { processMode: 'APPROVE' }]) {
      expect(schemas.oracleFusionHcmCreateTimeEntryBodySchema.safeParse({ ...range, ...change }).success).toBe(false)
    }
    expect(schemas.oracleFusionHcmUpdateTimeEntryBodySchema.safeParse(range).success).toBe(false)
    const update = { ...auth, personNumber: '0007', timeRecordId: '9007199254740993', timeRecordVersion: 2 }
    expect(schemas.oracleFusionHcmUpdateTimeEntryBodySchema.safeParse(update).success).toBe(false)
    for (const change of [{ stopTime: range.stopTime }, { measure: 8 }, { payrollTimeType: 'REGULAR' }]) {
      expect(schemas.oracleFusionHcmUpdateTimeEntryBodySchema.safeParse({ ...update, ...change }).success).toBe(true)
    }
    expect(schemas.oracleFusionHcmDeleteTimeEntryBodySchema.safeParse({ ...auth, personNumber: '0007', timeRecordId: '9007199254740993', timeRecordVersion: 2 }).success).toBe(true)
    expect(schemas.oracleFusionHcmDeleteTimeEntryBodySchema.safeParse({ ...auth, personNumber: '0007', timeRecordId: '2', timeRecordVersion: 0 }).success).toBe(false)
  })

  it('bounds finder bindings and prevents separator injection', () => {
    const input = { ...auth, dataSourceUsageId: '1', timeAttributeUsageId: '2' }
    for (const bindings of [[{ name: 'pAssignmentId', value: '1,pEffectiveDate=2026-01-01' }], [{ name: '../resource', value: '1' }], [{ name: 'pAssignmentId', value: '1' }, { name: 'pAssignmentId', value: '2' }]]) {
      expect(schemas.oracleFusionHcmListTimeAttributeValuesBodySchema.safeParse({ ...input, bindings }).success).toBe(false)
    }
  })

  it('preserves nullable identifiers in payroll lists and pending time events', () => {
    const period = projectors.projectPayrollTimePeriod({ TimePeriodId: null })
    const result = projectors.projectPersonProcessResult({ ObjectActionId: null })
    const event = projectors.projectTimeRecordRequestEvent({ timeRecordEventId: null, eventStatus: 'New' })
    expect(period.timePeriodId).toBeNull()
    expect(result.objectActionId).toBeNull()
    expect(event.timeRecordEventId).toBeNull()
    expect(schemas.oracleFusionHcmPayrollTimePeriodSchema.safeParse(period).success).toBe(true)
    expect(schemas.oracleFusionHcmPersonProcessResultSchema.safeParse(result).success).toBe(true)
    expect(schemas.oracleFusionHcmTimeRecordRequestEventSchema.safeParse(event).success).toBe(true)
  })

  it('preserves documented string-valued result, goal, flag, and message fields', () => {
    expect(projectors.projectPayrollRunResult({ RunResultId: '1', ResultValue: '123456789012345.6700' }).resultValue).toBe('123456789012345.6700')
    expect(projectors.projectPayrollBalance({ Value10: '0.0000', TotalValue1: null }).value10).toBe('0.0000')
    expect(projectors.projectPerformanceGoal({ GoalId: '2', PercentComplete: '25' }).percentComplete).toBe('25')
    expect(projectors.projectSalary({ SalaryId: '3', PendingTransactionExists: 'N' }).pendingTransactionExists).toBe('N')
    expect(projectors.projectTimeRecordEventMessage({ timeRecordEventMessageId: '4', allowException: 'N' }).allowException).toBe('N')
    expect(projectors.projectTimeRecordRequestEvent({ timeRecordEventId: '5', reporterId: '0007' }).reporterId).toBe('0007')
  })
})
