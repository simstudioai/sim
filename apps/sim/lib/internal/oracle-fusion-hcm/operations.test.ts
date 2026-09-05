import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-hcm/operations'
import { workersResponseSchema } from '@/lib/internal/oracle-fusion-hcm/schema'

const mocks = vi.hoisted(() => ({ requestOracleFusionJson: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.requestOracleFusionJson,
}))

const origin = 'https://acme.fa.ocs.oraclecloud.com'
const root = '/hcmRestApi/resources/11.13.18.05'
const TEST_ACCESS_TOKEN = 'test-access-token'
const auth = { instanceUrl: origin, accessToken: TEST_ACCESS_TOKEN }
const WORKER_FIELDS =
  'PersonId,PersonNumber,DisplayName,FullName,FirstName,LastName,KnownAs,WorkEmail,Username'
const ASSIGNMENT_FIELDS =
  'AssignmentId,AssignmentNumber,AssignmentName,StartDate,PrimaryFlag,PrimaryAssignmentFlag,WorkerType,WorkerNumber,FullPartTime,LegalEmployerName,BusinessUnitName,DepartmentName,JobCode,JobName,PositionCode,PositionName,LocationCode,LocationName,ManagerName'
const MANAGER_FIELDS =
  'AssignmentSupervisorId,ManagerAssignmentId,ManagerAssignmentNumber,ManagerAssignmentName,ManagerPersonId,ManagerPersonNumber,DisplayName,FirstName,KnownAs,LastName,ManagerType,ManagerTypeMeaning,JobCode,JobName,PositionCode,PositionName,WorkEmail'
const DIRECT_REPORT_FIELDS =
  'AssignmentId,AssignmentNumber,AssignmentName,PersonId,PersonNumber,DisplayName,FirstName,KnownAs,LastName,RelationshipType,RelationshipTypeMeaning,WorkerType,DirectReportsCount,AllReportsCount'
const ABSENCE_FIELDS =
  'personAbsenceEntryId,personId,personNumber,absenceTypeId,absenceType,absenceStatusCd,absenceDispStatus,absenceDispStatusMeaning,approvalStatusCd,assignmentId,assignmentName,assignmentNumber,startDate,startTime,endDate,endTime,duration,formattedDuration,unitOfMeasure,unitOfMeasureMeaning,openEndedFlag,singleDayFlag,employer,lastUpdateDate'
const ABSENCE_TYPE_FIELDS =
  'AbsenceTypeId,AbsenceTypeName,AbsTypeWithEmployerName,Description,EmployerId,EmployerName,DurationCalculationBasis,DurationUOMCode,DurationUOMCodeMeaning,DisplaySequence'

function collection(items: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    items,
    count: items.length,
    hasMore: false,
    limit: 20,
    offset: 0,
    ...overrides,
  }
}

function self(path: string) {
  return [{ rel: 'self', href: `${origin}${root}/${path}` }]
}

function workerDiscovery(personId = '1', key = 'worker key') {
  return collection(
    [{ PersonId: personId, links: self(`publicWorkers/${encodeURIComponent(key)}`) }],
    { limit: 2 }
  )
}

function assignmentDiscovery(
  assignmentId = '2',
  workerKey = 'worker key',
  assignmentKey = 'assignment:2'
) {
  return collection(
    [
      {
        AssignmentId: assignmentId,
        links: self(
          `publicWorkers/${encodeURIComponent(workerKey)}/child/assignments/${encodeURIComponent(assignmentKey)}`
        ),
      },
    ],
    { limit: 2 }
  )
}

function lastRequest() {
  return mocks.requestOracleFusionJson.mock.calls.at(-1)?.[1]
}

describe('Oracle Fusion HCM operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes worker search through the shared HCM client with v9 escaping and safe fields', async () => {
    mocks.requestOracleFusionJson.mockResolvedValue(
      collection(
        [
          {
            PersonId: '9223372036854775807',
            DisplayName: 'Ada Lovelace',
            WorkEmail: 'ada@example.com',
            HomeAddress: 'secret',
            Phones: [{ Number: '555' }],
            DateOfBirth: '1815-12-10',
          },
        ],
        { count: 1, hasMore: true, limit: 73, offset: 0, totalResults: 100 }
      )
    )
    const result = await operations.executeOracleFusionHcmListWorkers({
      ...auth,
      search: `A%_*?\\"'`,
      limit: 20,
      offset: 0,
    })

    expect(mocks.requestOracleFusionJson).toHaveBeenCalledWith(
      auth,
      {
        address: { family: 'hcm', relativePath: 'publicWorkers' },
        query: {
          fields: WORKER_FIELDS,
          limit: 20,
          offset: 0,
          onlyData: true,
          q: `PersonNumber LIKE '%A\\%\\_\\*\\?\\\\"''%' OR DisplayName LIKE '%A\\%\\_\\*\\?\\\\"''%' OR WorkEmail LIKE '%A\\%\\_\\*\\?\\\\"''%'`,
        },
      },
      undefined
    )
    const query = lastRequest().query
    expect(query.fields).toBe(WORKER_FIELDS)
    expect(query.onlyData).toBe(true)
    expect(result.output).toMatchObject({
      count: 1,
      hasMore: true,
      limit: 73,
      offset: 0,
      totalResults: 100,
      nextOffset: 1,
    })
    expect(result.output.workers[0]).toEqual(
      expect.objectContaining({ personId: '9223372036854775807', displayName: 'Ada Lovelace' })
    )
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('555')
    expect(JSON.stringify(result)).not.toContain('1815')
  })

  it('discovers and encodes opaque worker keys before item and child traversal', async () => {
    mocks.requestOracleFusionJson
      .mockResolvedValueOnce(workerDiscovery())
      .mockResolvedValueOnce(
        collection([{ AssignmentId: '2', AssignmentName: 'Primary' }], { limit: 10, offset: 7 })
      )
    await operations.executeOracleFusionHcmListWorkerAssignments({
      ...auth,
      personId: '1',
      limit: 10,
      offset: 7,
    })

    expect(mocks.requestOracleFusionJson.mock.calls[0]).toEqual([
      auth,
      {
        address: { family: 'hcm', relativePath: 'publicWorkers' },
        query: {
          fields: WORKER_FIELDS,
          q: 'PersonId=1',
          limit: 2,
          offset: 0,
          links: 'self',
        },
      },
      undefined,
    ])
    expect(mocks.requestOracleFusionJson.mock.calls[1]).toEqual([
      auth,
      {
        address: { family: 'hcm', relativePath: 'publicWorkers/worker%20key/child/assignments' },
        query: { fields: ASSIGNMENT_FIELDS, limit: 10, offset: 7, onlyData: true },
      },
      undefined,
    ])
  })

  it('discovers and encodes opaque assignment keys before item and reporting traversal', async () => {
    for (const [execute, finalPath, item] of [
      [
        operations.executeOracleFusionHcmGetWorkerAssignment,
        'publicWorkers/worker%20key/child/assignments/assignment%3A2',
        {
          AssignmentId: '2',
          links: self('publicWorkers/worker%20key/child/assignments/assignment%3A2'),
        },
      ],
      [
        operations.executeOracleFusionHcmListWorkerManagers,
        'publicWorkers/worker%20key/child/assignments/assignment%3A2/child/managers',
        collection([{ AssignmentSupervisorId: '3' }]),
      ],
      [
        operations.executeOracleFusionHcmListWorkerDirectReports,
        'publicWorkers/worker%20key/child/assignments/assignment%3A2/child/directReports',
        collection([{ AssignmentId: null, PersonId: null, DisplayName: 'Unassigned report' }]),
      ],
    ] as const) {
      mocks.requestOracleFusionJson.mockClear()
      mocks.requestOracleFusionJson
        .mockResolvedValueOnce(workerDiscovery())
        .mockResolvedValueOnce(assignmentDiscovery())
        .mockResolvedValueOnce(item)
      const result = await execute({ ...auth, personId: '1', assignmentId: '2' } as never)
      expect(mocks.requestOracleFusionJson.mock.calls[0]).toEqual([
        auth,
        {
          address: { family: 'hcm', relativePath: 'publicWorkers' },
          query: {
            fields: WORKER_FIELDS,
            q: 'PersonId=1',
            limit: 2,
            offset: 0,
            links: 'self',
          },
        },
        undefined,
      ])
      expect(mocks.requestOracleFusionJson.mock.calls[1]).toEqual([
        auth,
        {
          address: { family: 'hcm', relativePath: 'publicWorkers/worker%20key/child/assignments' },
          query: {
            fields: ASSIGNMENT_FIELDS,
            q: 'AssignmentId=2',
            limit: 2,
            offset: 0,
            links: 'self',
          },
        },
        undefined,
      ])
      const finalQuery = finalPath.endsWith('assignment%3A2')
        ? { fields: ASSIGNMENT_FIELDS, links: 'self' }
        : finalPath.endsWith('managers')
          ? { fields: MANAGER_FIELDS, limit: 20, offset: 0, onlyData: true }
          : { fields: DIRECT_REPORT_FIELDS, limit: 20, offset: 0, onlyData: true }
      expect(mocks.requestOracleFusionJson.mock.calls[2]).toEqual([
        auth,
        { address: { family: 'hcm', relativePath: finalPath }, query: finalQuery },
        undefined,
      ])
      if ('directReports' in result.output) {
        expect(result.output.directReports[0]).toMatchObject({ assignmentId: null, personId: null })
      }
    }
  })

  it('validates exact worker and assignment item IDs and self links', async () => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(workerDiscovery()).mockResolvedValueOnce({
      PersonId: '1',
      links: self('publicWorkers/worker%20key'),
    })
    await expect(
      operations.executeOracleFusionHcmGetWorker({ ...auth, personId: '1' })
    ).resolves.toMatchObject({ output: { worker: { personId: '1' } } })
    expect(mocks.requestOracleFusionJson.mock.calls[1]).toEqual([
      auth,
      {
        address: { family: 'hcm', relativePath: 'publicWorkers/worker%20key' },
        query: { fields: WORKER_FIELDS, links: 'self' },
      },
      undefined,
    ])

    mocks.requestOracleFusionJson
      .mockResolvedValueOnce(workerDiscovery())
      .mockResolvedValueOnce(assignmentDiscovery())
      .mockResolvedValueOnce({
        AssignmentId: '9',
        links: self('publicWorkers/worker%20key/child/assignments/assignment%3A2'),
      })
    await expect(
      operations.executeOracleFusionHcmGetWorkerAssignment({
        ...auth,
        personId: '1',
        assignmentId: '2',
      })
    ).rejects.toMatchObject({
      status: 502,
      message: 'Oracle Fusion HCM returned a different assignment than requested',
    })
  })

  it.each([
    ['missing', []],
    ['duplicate', self('publicWorkers/one').concat(self('publicWorkers/two'))],
    ['malformed', [{ rel: 'self', href: 'not a URL' }]],
    [
      'foreign',
      [
        {
          rel: 'self',
          href: 'https://evil.example.com/hcmRestApi/resources/11.13.18.05/publicWorkers/key',
        },
      ],
    ],
  ])('rejects a %s worker self-link', async (_case, links) => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(
      collection([{ PersonId: '1', links }], { limit: 2 })
    )
    await expect(
      operations.executeOracleFusionHcmGetWorker({ ...auth, personId: '1' })
    ).rejects.toMatchObject({
      status: 502,
      message: 'Oracle Fusion HCM returned an invalid self link',
    })
    expect(mocks.requestOracleFusionJson).toHaveBeenCalledTimes(1)
  })

  it('rejects missing, duplicate, and mismatched business-ID discovery', async () => {
    for (const response of [
      collection([], { limit: 2 }),
      collection(
        [
          { PersonId: '1', links: self('publicWorkers/one') },
          { PersonId: '1', links: self('publicWorkers/two') },
        ],
        { limit: 2 }
      ),
      collection([{ PersonId: '9', links: self('publicWorkers/nine') }], { limit: 2 }),
    ]) {
      mocks.requestOracleFusionJson.mockResolvedValueOnce(response)
      await expect(
        operations.executeOracleFusionHcmGetWorker({ ...auth, personId: '1' })
      ).rejects.toMatchObject({ status: expect.any(Number) })
      expect(mocks.requestOracleFusionJson.mock.calls.at(-1)?.[1].address.relativePath).toBe(
        'publicWorkers'
      )
    }
  })

  it('rejects missing, duplicate, mismatched, malformed, and foreign assignment discovery', async () => {
    const invalidAssignments = [
      collection([], { limit: 2 }),
      collection(
        [
          {
            AssignmentId: '2',
            links: self('publicWorkers/worker%20key/child/assignments/one'),
          },
          {
            AssignmentId: '2',
            links: self('publicWorkers/worker%20key/child/assignments/two'),
          },
        ],
        { limit: 2 }
      ),
      collection(
        [
          {
            AssignmentId: '9',
            links: self('publicWorkers/worker%20key/child/assignments/nine'),
          },
        ],
        { limit: 2 }
      ),
      collection([{ AssignmentId: '2', links: [{ rel: 'self', href: 'not a URL' }] }], {
        limit: 2,
      }),
      collection(
        [
          {
            AssignmentId: '2',
            links: [
              {
                rel: 'self',
                href: 'https://evil.example.com/hcmRestApi/resources/11.13.18.05/publicWorkers/worker%20key/child/assignments/two',
              },
            ],
          },
        ],
        { limit: 2 }
      ),
    ]

    for (const response of invalidAssignments) {
      mocks.requestOracleFusionJson
        .mockResolvedValueOnce(workerDiscovery())
        .mockResolvedValueOnce(response)
      await expect(
        operations.executeOracleFusionHcmGetWorkerAssignment({
          ...auth,
          personId: '1',
          assignmentId: '2',
        })
      ).rejects.toMatchObject({ status: expect.any(Number) })
    }
  })

  it('rejects unsafe integral IDs while normalizing documented nullable and boolean fields', async () => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(
      collection([{ PersonId: 9_223_372_036_854_776_000 }])
    )
    await expect(operations.executeOracleFusionHcmListWorkers({ ...auth })).rejects.toMatchObject({
      status: 502,
      message: 'Oracle Fusion HCM response is missing PersonId',
    })

    mocks.requestOracleFusionJson.mockResolvedValueOnce(
      collection([
        { PersonTypeId: '1', ActiveFlag: 'Y', DefaultFlag: 'false', UserPersonType: null },
      ])
    )
    const result = await operations.executeOracleFusionHcmListPersonTypes({ ...auth })
    expect(result.output.personTypes[0]).toMatchObject({
      personTypeId: '1',
      activeFlag: true,
      defaultFlag: false,
      userPersonType: null,
    })
  })

  it('uses each documented absence finder and requires an exact detail result', async () => {
    mocks.requestOracleFusionJson.mockResolvedValue(collection([{ personAbsenceEntryId: '9' }]))

    await operations.executeOracleFusionHcmListAbsences({ ...auth, personId: '1' })
    expect(lastRequest()).toEqual({
      address: { family: 'hcm', relativePath: 'absences' },
      query: {
        fields: ABSENCE_FIELDS,
        limit: 20,
        offset: 0,
        onlyData: true,
        finder: 'findByPersonId;personId=1',
      },
    })

    await operations.executeOracleFusionHcmListAbsences({
      ...auth,
      personId: '1',
      absenceTypeId: '2',
    })
    expect(lastRequest()).toEqual({
      address: { family: 'hcm', relativePath: 'absences' },
      query: {
        fields: ABSENCE_FIELDS,
        limit: 20,
        offset: 0,
        onlyData: true,
        finder: 'findByPersonAndAbsenceTypeId;absenceTypeId=2,personId=1',
      },
    })

    await operations.executeOracleFusionHcmListAbsences({
      ...auth,
      personId: '1',
      absenceTypeId: '2',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
    expect(lastRequest()).toEqual({
      address: { family: 'hcm', relativePath: 'absences' },
      query: {
        fields: ABSENCE_FIELDS,
        limit: 20,
        offset: 0,
        onlyData: true,
        finder:
          'findByPersonAbsenceTypeIdAndAbsDate;absenceTypeId=2,endDate=2026-01-31,personId=1,startDate=2026-01-01',
      },
    })

    mocks.requestOracleFusionJson.mockResolvedValueOnce(
      collection([{ personAbsenceEntryId: '8' }], { limit: 2 })
    )
    await expect(
      operations.executeOracleFusionHcmGetAbsence({ ...auth, absenceId: '9' })
    ).rejects.toMatchObject({ status: 502 })
    expect(lastRequest()).toEqual({
      address: { family: 'hcm', relativePath: 'absences' },
      query: {
        fields: ABSENCE_FIELDS,
        limit: 2,
        offset: 0,
        onlyData: true,
        finder: 'findByAbsenceEntryId;personAbsenceEntryId=9',
      },
    })
  })

  it('returns safe absence 404s and rejects duplicate detail finder results', async () => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(collection([], { limit: 2 }))
    await expect(
      operations.executeOracleFusionHcmGetAbsence({ ...auth, absenceId: '9' })
    ).rejects.toMatchObject({ status: 404, message: 'Oracle Fusion HCM absence was not found' })

    mocks.requestOracleFusionJson.mockResolvedValueOnce(
      collection([{ personAbsenceEntryId: '9' }, { personAbsenceEntryId: '9' }], { limit: 2 })
    )
    await expect(
      operations.executeOracleFusionHcmGetAbsence({ ...auth, absenceId: '9' })
    ).rejects.toMatchObject({ status: 502 })
  })

  it('uses the bounded absence-type finder without exposing raw finder syntax', async () => {
    mocks.requestOracleFusionJson.mockResolvedValue(
      collection([{ AbsenceTypeId: '2', AbsenceTypeName: 'Vacation' }])
    )
    const result = await operations.executeOracleFusionHcmListAbsenceTypes({
      ...auth,
      personId: '1',
      search: 'Vac,ation;all',
      effectiveDate: '2026-02-03',
    })
    expect(lastRequest()).toEqual({
      address: { family: 'hcm', relativePath: 'absenceTypesLOV' },
      query: {
        fields: ABSENCE_TYPE_FIELDS,
        limit: 20,
        offset: 0,
        onlyData: true,
        finder:
          'findByWord;PersonId=1,SearchTerms=Vac ation all,AbsenceTypeEffectiveDate=2026-02-03',
      },
    })
    expect(result.output.absenceTypes[0].name).toBe('Vacation')
  })

  it('maps all nine workforce-structure operations to exact documented request contracts', async () => {
    const cases = [
      [
        operations.executeOracleFusionHcmListJobs,
        { JobId: '1', Name: 'Engineer' },
        'jobs',
        'JobId,JobCode,Name,ActiveStatus,JobFamilyId,JobFunctionCode,ManagerLevel,RegularTemporary,FullPartTime,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['JobCode', 'Name'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListJobFamilies,
        { JobFamilyId: '1', JobFamilyName: 'Engineering' },
        'jobFamilies',
        'JobFamilyId,JobFamilyCode,JobFamilyName,ActiveStatus,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['JobFamilyCode', 'JobFamilyName'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListDepartments,
        { OrganizationId: '1', Name: 'Engineering' },
        'organizations',
        'OrganizationId,OrganizationCode,Name,ClassificationCode,Status,LocationId,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['OrganizationCode', 'Name'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListLocations,
        { LocationId: '1', LocationName: 'Seattle' },
        'locations',
        'LocationId,LocationCode,LocationName,Description,ActiveStatus,Country,TownOrCity,Region1,Region2,Region3,PostalCode,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['LocationCode', 'LocationName'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListPositions,
        { PositionId: '1', Name: 'Engineer' },
        'positions',
        'PositionId,PositionCode,Name,ActiveStatus,PositionType,JobId,DepartmentId,LocationId,BusinessUnitId,RegularTemporary,FullPartTime,HiringStatus,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['PositionCode', 'Name'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListBusinessUnits,
        { BusinessUnitId: '1', Name: 'Operations' },
        'hcmBusinessUnitsLOV',
        'BusinessUnitId,Name,Status',
        ['Name'],
        false,
      ],
      [
        operations.executeOracleFusionHcmListLegalEmployers,
        { OrganizationId: '1', Name: 'Acme' },
        'legalEmployersLov',
        'OrganizationId,Name,LegislationCode,EffectiveStartDate,EffectiveEndDate',
        ['Name'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListGrades,
        { GradeId: '1', GradeName: 'G7' },
        'grades',
        'GradeId,GradeCode,GradeName,ActiveStatus,CategoryCode,SetId,EffectiveStartDate,EffectiveEndDate,LastUpdateDate',
        ['GradeCode', 'GradeName'],
        true,
      ],
      [
        operations.executeOracleFusionHcmListPersonTypes,
        { PersonTypeId: '1', UserPersonType: 'Employee' },
        'personTypesLOV',
        'PersonTypeId,SystemPersonType,UserPersonType,ActiveFlag,DefaultFlag',
        ['SystemPersonType', 'UserPersonType'],
        false,
      ],
    ] as const
    for (const [
      execute,
      item,
      expectedPath,
      fields,
      searchFields,
      supportsEffectiveDate,
    ] of cases) {
      mocks.requestOracleFusionJson.mockResolvedValueOnce(
        collection([item], { limit: 17, offset: 3 })
      )
      const result = await execute({
        ...auth,
        search: 'Engineer',
        ...(supportsEffectiveDate ? { effectiveDate: '2026-03-04' } : {}),
        limit: 17,
        offset: 3,
      } as never)
      expect(lastRequest()).toEqual({
        address: { family: 'hcm', relativePath: expectedPath },
        query: {
          fields,
          limit: 17,
          offset: 3,
          onlyData: true,
          q: searchFields.map((field) => `${field} LIKE '%Engineer%'`).join(' OR '),
          ...(supportsEffectiveDate ? { effectiveDate: '2026-03-04' } : {}),
        },
      })
      expect(JSON.stringify(result)).toContain(Object.values(item)[1])
    }
  })

  it('preserves exact scientific-notation IDs and framework-v9 context self links', async () => {
    mocks.requestOracleFusionJson
      .mockResolvedValueOnce(
        collection(
          [
            {
              PersonId: '9.223372036854775807e18',
              '@context': { links: self('publicWorkers/opaque%3Aworker') },
            },
          ],
          { limit: 2 }
        )
      )
      .mockResolvedValueOnce({
        PersonId: '9223372036854775807',
        '@context': { links: self('publicWorkers/opaque%3Aworker') },
      })
    const result = await operations.executeOracleFusionHcmGetWorker({
      ...auth,
      personId: '9223372036854775807',
    })
    expect(result.output.worker.personId).toBe('9223372036854775807')
    expect(lastRequest().address.relativePath).toBe('publicWorkers/opaque%3Aworker')
  })

  it.each([
    ['unexpected offset', { offset: 1 }],
    ['too many items', { items: [{ PersonId: '1' }, { PersonId: '2' }], count: 2 }],
  ])('rejects a provider page with %s', async (_case, overrides) => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(collection([{ PersonId: '1' }], overrides))
    await expect(
      operations.executeOracleFusionHcmListWorkers({
        ...auth,
        limit: 1,
        offset: 0,
      })
    ).rejects.toMatchObject({ status: 502 })
  })

  it('returns a schema-valid terminal page without a next offset', async () => {
    mocks.requestOracleFusionJson.mockResolvedValueOnce(collection([{ PersonId: '1' }]))
    const result = await operations.executeOracleFusionHcmListWorkers(auth)
    expect(workersResponseSchema.parse(result)).toEqual(result)
    expect(result.output).not.toHaveProperty('nextOffset')
  })

  it('checks cancellation after a shared request resolves', async () => {
    const controller = new AbortController()
    mocks.requestOracleFusionJson.mockImplementationOnce(async () => {
      controller.abort(new Error('caller stopped'))
      return collection([])
    })
    await expect(
      operations.executeOracleFusionHcmListWorkers({ ...auth }, controller.signal)
    ).rejects.toThrow('caller stopped')
  })

  it('wraps shared provider errors with fixed HCM-facing messages', async () => {
    for (const [status, message] of [
      [401, 'Oracle Fusion HCM authentication failed'],
      [403, 'Oracle Fusion HCM denied this request'],
      [404, 'Oracle Fusion HCM resource was not found'],
      [429, 'Oracle Fusion HCM rate limit exceeded'],
      [502, 'Oracle Fusion HCM request failed'],
      [504, 'Oracle Fusion HCM request timed out'],
    ] as const) {
      mocks.requestOracleFusionJson.mockRejectedValueOnce(
        new OracleFusionProviderError('private shared detail', status)
      )
      await expect(operations.executeOracleFusionHcmListWorkers({ ...auth })).rejects.toMatchObject(
        {
          status,
          message,
        }
      )
    }
  })
})
