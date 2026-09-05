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
      expect(JSON.stringify(result)).not.toContain('private')
    }
  )
})
