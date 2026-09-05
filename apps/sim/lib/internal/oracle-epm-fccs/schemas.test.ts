/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  assertFccsHierarchyBudget,
  FCCS_MEMBER_BUDGET,
  fccsApplicationsSchema,
  fccsChildJobType,
  fccsDataGridInput,
  fccsDetailJobType,
  fccsJobSchema,
  fccsJobType,
  fccsJournalPeriodSchema,
  fccsMemberSchema,
} from '@/lib/internal/oracle-epm-fccs/schemas'

describe('FCCS documented projections', () => {
  it.each([{ jobId: 42 }, { jobID: 42 }, { jobId: 42, jobID: 42 }])(
    'normalizes documented job ID variants %j',
    (ids) => {
      expect(
        fccsJobSchema.parse({ ...ids, status: -1, details: null, tenantSecret: 'hidden' })
      ).toEqual({ jobId: '42', status: -1, details: null })
    }
  )
  it.each([
    { status: 0 },
    { jobId: 1, jobID: 2, status: 0 },
    { jobId: '42', status: 0 },
    { jobId: Number.MAX_SAFE_INTEGER + 1, status: 0 },
    { jobId: 1, status: '0' },
  ])('rejects unsupported or ambiguous job data %j', (value) => {
    expect(fccsJobSchema.safeParse(value).success).toBe(false)
  })
  it('projects stable application/member fields without guessing tenant types or children', () => {
    expect(
      fccsApplicationsSchema.parse({
        items: [
          {
            name: 'Close',
            appType: 'future tenant type',
            adminMode: 'false',
            tenantSecret: 'hidden',
          },
        ],
      })
    ).toEqual({ items: [{ name: 'Close', appType: 'future tenant type' }] })
    expect(
      fccsMemberSchema.parse({
        name: 'Entity',
        parentName: null,
        children: { undocumented: true },
        tenantSecret: 'hidden',
      })
    ).toEqual({ name: 'Entity', parentName: null })
    expect(fccsApplicationsSchema.safeParse({ items: [{}] }).success).toBe(false)
  })
  it('recognizes both documented journal-period alternatives, not an invented job', () => {
    expect(
      fccsJournalPeriodSchema.parse({ actionStatus: 0, actionDetail: 'Success', jobId: 42 })
    ).toEqual({ actionStatus: 0, actionDetail: 'Success' })
    expect(
      fccsJournalPeriodSchema.safeParse({
        scenario: 'Actual',
        year: 'FY26',
        period: 'Jan',
        action: 'OPEN',
      }).success
    ).toBe(true)
    expect(fccsJournalPeriodSchema.safeParse({ status: 0 }).success).toBe(false)
  })
  it('bounds hierarchy work before recursive projection without silently truncating', () => {
    const root = {
      name: 'Entity',
      children: Array.from({ length: FCCS_MEMBER_BUDGET - 1 }, (_, i) => ({ name: String(i) })),
    }
    expect(() => assertFccsHierarchyBudget(root)).not.toThrow()
    root.children.push({ name: 'overflow' })
    expect(() => assertFccsHierarchyBudget(root)).toThrow('Advanced')
    let deep: unknown = { name: 'leaf' }
    for (let i = 0; i < 65; i++) deep = { name: String(i), children: [deep] }
    expect(() => assertFccsHierarchyBudget(deep)).toThrow('64 levels')
  })
  it('accepts numeric FCCS slice cells but rejects Planning cell notes and text data', () => {
    const grid = {
      pov: ['Actual'],
      columns: [['Jan']],
      rows: [{ headers: ['Entity'], data: [42, '3.5', '#missing'] }],
    }
    expect(fccsDataGridInput.parse(grid)).toEqual(grid)
    expect(fccsDataGridInput.safeParse({ ...grid, cellNotes: [] }).success).toBe(false)
    expect(
      fccsDataGridInput.safeParse({ ...grid, rows: [{ headers: [], data: ['arbitrary text'] }] })
        .success
    ).toBe(false)
  })
  it('keeps job execution and detail endpoints within documented FCCS families', () => {
    for (const type of [
      'DELETE_APPLICATION',
      'IMPORT_DATABASE',
      'PIPELINE',
      'INTEGRATION',
      'SNAPSHOT',
    ])
      expect(fccsJobType.safeParse(type).success).toBe(false)
    expect(fccsDetailJobType.safeParse('RULES').success).toBe(false)
    expect(fccsChildJobType.safeParse('IMPORT_DATA').success).toBe(false)
    expect(fccsChildJobType.safeParse('IMPORT_METADATA').success).toBe(true)
  })
})
