/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  arcsCommentsSchema,
  arcsFailure,
  arcsFilesSchema,
  arcsInputSchemas,
  arcsJobSchema,
  arcsPeriodsSchema,
  arcsUsersSchema,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'

const auth = { accessToken: 'dTpw', instanceUrl: 'https://epm.example.com' }
describe('documented matching filter safety', () => {
  it('preserves cancellation and timeout categories without exposing arbitrary abort reasons', () => {
    const output = { accepted: true, jobId: '42' }
    expect(arcsFailure(new DOMException('private reason', 'AbortError'), output)).toEqual({
      success: false,
      output,
      error: 'Oracle EPM operation was cancelled',
    })
    expect(arcsFailure(new DOMException('private reason', 'TimeoutError'), output)).toEqual({
      success: false,
      output,
      error: 'Oracle EPM operation exceeded its time budget',
    })
    expect(arcsFailure(new DOMException('timeout', 'AbortError'), output).error).toBe(
      'Oracle EPM operation exceeded its time budget'
    )
  })
  it.each(['archive_matched_transactions', 'purge_matched_transactions'] as const)(
    '%s requires a complete optional account filter',
    (action) => {
      const schema = arcsInputSchemas[action]
      const base = { ...auth, matchTypeId: 'MT', age: 120 }
      expect(schema.safeParse({ ...base, filterOperator: 'EQUALS' }).success).toBe(false)
      expect(schema.safeParse({ ...base, filterValue: ['A'] }).success).toBe(false)
      expect(
        schema.safeParse({ ...base, filterOperator: 'EQUALS', filterValue: ['A', 'B'] }).success
      ).toBe(true)
      expect(schema.safeParse(base).success).toBe(true)
    }
  )
  it.each(['STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'NOT_CONTAINS'])(
    'purge restricts %s to its documented single value',
    (filterOperator) => {
      const base = { ...auth, matchTypeId: 'MT', age: 120, filterOperator }
      expect(
        arcsInputSchemas.purge_matched_transactions.safeParse({ ...base, filterValue: ['A', 'B'] })
          .success
      ).toBe(false)
      expect(
        arcsInputSchemas.purge_matched_transactions.safeParse({ ...base, filterValue: ['A'] })
          .success
      ).toBe(true)
    }
  )
  it('accepts only documented reconciliation attribute rules', () => {
    const base = { ...auth, period: 'Jan', fileName: 'attributes.csv' }
    expect(
      arcsInputSchemas.import_reconciliation_attributes.safeParse({
        ...base,
        rules: 'AUTO_APP,AUTO_SUB',
      }).success
    ).toBe(true)
    expect(
      arcsInputSchemas.import_reconciliation_attributes.safeParse({ ...base, rules: 'invented' })
        .success
    ).toBe(false)
  })
})
const cases = [
  {
    id: 'add_users_to_team',
    input: {
      fileName: 'input.csv',
      teamName: 'example',
    },
  },
  {
    id: 'archive_matched_transactions',
    input: {
      matchTypeId: 'example',
      age: 42,
    },
  },
  {
    id: 'create_reconciliations',
    input: {
      period: 'January 2026',
    },
  },
  {
    id: 'delete_file',
    input: {
      fileName: 'input.csv',
    },
  },
  {
    id: 'delete_profile',
    input: {
      accountId: 'example',
    },
  },
  {
    id: 'download_comment_attachment',
    input: {
      period: 'January 2026',
      accountId: 'example',
      referenceId: '7',
    },
  },
  {
    id: 'download_file',
    input: {
      fileName: 'input.csv',
    },
  },
  {
    id: 'export_user_details_report',
    input: {
      fileName: 'input.csv',
    },
  },
  {
    id: 'get_compliance_job_status',
    input: {
      jobId: '42',
    },
  },
  {
    id: 'get_matching_job_status',
    input: {
      jobId: '42',
    },
  },
  {
    id: 'import_balances',
    input: {
      period: 'January 2026',
      dataLoadDefinition: 'example',
    },
  },
  {
    id: 'import_compliance_transactions',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      transactionType: 'BEX',
      dateFormat: 'example',
    },
  },
  {
    id: 'import_matching_transactions',
    input: {
      fileName: 'input.csv',
      matchTypeId: 'example',
      dataSource: 'example',
      dateFormat: 'example',
    },
  },
  {
    id: 'import_premapped_balances',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      balanceType: 'SRC',
      currencyBucket: 'example',
    },
  },
  {
    id: 'import_profiles',
    input: {
      fileName: 'input.csv',
      importType: 'Replace',
      profileType: 'Profiles',
      dateFormat: 'example',
    },
  },
  {
    id: 'import_rates',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      rateType: 'example',
      importType: 'Replace',
    },
  },
  {
    id: 'import_reconciliation_attributes',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
    },
  },
  {
    id: 'list_files',
    input: {},
  },
  {
    id: 'list_periods',
    input: {},
  },
  {
    id: 'list_reconciliation_comments',
    input: {
      period: 'January 2026',
      accountId: 'example',
    },
  },
  {
    id: 'list_users',
    input: {},
  },
  {
    id: 'monitor_reconciliations',
    input: {
      periodName: 'January 2026',
      filterName: 'example',
    },
  },
  {
    id: 'purge_archived_transactions',
    input: {
      jobId: '42',
    },
  },
  {
    id: 'purge_matched_transactions',
    input: {
      matchTypeId: 'example',
      age: 42,
    },
  },
  {
    id: 'remove_users_from_team',
    input: {
      fileName: 'input.csv',
      teamName: 'example',
    },
  },
  {
    id: 'run_auto_alert',
    input: {
      matchTypeId: 'example',
    },
  },
  {
    id: 'run_auto_match',
    input: {
      matchTypeId: 'example',
    },
  },
  {
    id: 'run_profile_rules',
    input: {
      period: 'January 2026',
    },
  },
  {
    id: 'run_reconciliation_rules',
    input: {
      period: 'January 2026',
    },
  },
  {
    id: 'set_period_status',
    input: {
      period: 'January 2026',
      status: 'pending',
    },
  },
  {
    id: 'unmatch_auto_match_job',
    input: {
      autoMatchJobId: 42,
      createReverseAdjustment: false,
    },
  },
  {
    id: 'unmatch_transactions',
    input: {
      matchTypeId: 'example',
      matchIds: [12, 13],
    },
  },
  {
    id: 'upload_file',
    input: {
      file: {
        id: 'file-1',
        key: 'workspace/file.csv',
        url: '/api/files/file.csv',
        name: 'input.csv',
        type: 'text/csv',
        size: 3,
      },
    },
  },
] as const

describe('Account Reconciliation contracts', () => {
  it.each(cases)('$id admits documented required inputs', ({ id, input }) => {
    expect(arcsInputSchemas[id].safeParse({ ...auth, ...input }).success).toBe(true)
  })
  for (const entry of cases) {
    for (const field of Object.keys(entry.input)) {
      it(`${entry.id} requires ${field}`, () => {
        const input: Record<string, unknown> = { ...auth, ...entry.input }
        delete input[field]
        expect(arcsInputSchemas[entry.id].safeParse(input).success).toBe(false)
      })
    }
  }
  it.each([4, 301, 60.5, '60', Number.NaN])('rejects invalid wait value %s', (maxWaitSeconds) => {
    expect(
      arcsInputSchemas.run_auto_match.safeParse({ ...auth, matchTypeId: 'MT', maxWaitSeconds })
        .success
    ).toBe(false)
  })
  it('bounds matching batches and rejects unsafe or nonnumeric match IDs', () => {
    for (const matchIds of [
      [],
      [Number.MAX_SAFE_INTEGER + 1],
      ['1'],
      Array.from({ length: 10_001 }, () => 1),
    ]) {
      expect(
        arcsInputSchemas.unmatch_transactions.safeParse({ ...auth, matchTypeId: 'MT', matchIds })
          .success
      ).toBe(false)
    }
    expect(
      arcsInputSchemas.unmatch_transactions.safeParse({
        ...auth,
        matchTypeId: 'MT',
        matchIds: [1, 2],
        forceReopen: false,
      }).success
    ).toBe(true)
  })
  it('omits unverified attribute date spellings and unknown fields', () => {
    expect(
      arcsInputSchemas.import_reconciliation_attributes.parse({
        ...auth,
        period: 'Jan',
        fileName: 'inbox/a.csv',
        dateFormat: 'x',
        dateformat: 'x',
        jobName: 'OTHER',
      })
    ).toEqual({ ...auth, period: 'Jan', fileName: 'inbox/a.csv' })
  })
  it('preserves exact repository filenames and trims ordinary identifiers', () => {
    expect(
      arcsInputSchemas.download_file.parse({ ...auth, fileName: 'inbox/report final.csv' }).fileName
    ).toBe('inbox/report final.csv')
    expect(arcsInputSchemas.get_compliance_job_status.parse({ ...auth, jobId: ' 42 ' }).jobId).toBe(
      '42'
    )
  })
  it('requires real file metadata without authorizing through caller scope fields', () => {
    expect(
      arcsInputSchemas.upload_file.safeParse({ ...auth, file: 'https://example.com/file.csv' })
        .success
    ).toBe(false)
    expect(
      arcsInputSchemas.list_files.parse({
        ...auth,
        userId: 'forged',
        workspaceId: 'forged',
        _context: {},
      })
    ).toEqual(auth)
  })
  it('accepts nullable documented job details but not invented job envelopes', () => {
    expect(arcsJobSchema.parse({ status: 0, details: null, invented: { rows: [1] } })).toEqual({
      status: 0,
      details: null,
    })
    for (const value of [
      { status: '-1' },
      { status: -2 },
      { status: 0, details: {} },
      { status: 0, links: [{}] },
      [],
    ])
      expect(arcsJobSchema.safeParse(value).success).toBe(false)
  })
  it('uses documented period field casing and preserves nullable LCM file metadata', () => {
    expect(
      arcsPeriodsSchema.parse({ status: 0, items: [{ Id: '1', Name: 'Jan', Status: '51' }] })
        .items[0].Name
    ).toBe('Jan')
    expect(
      arcsPeriodsSchema.safeParse({ status: 0, items: [{ id: '1', name: 'Jan', status: 'OPEN' }] })
        .success
    ).toBe(false)
    expect(
      arcsFilesSchema.parse({
        status: 0,
        items: [{ name: 'Snapshot', type: 'LCM', size: null, lastmodifiedtime: null }],
      }).items[0].size
    ).toBeNull()
  })
  it('supports bare comment arrays and does not infer a record wrapper', () => {
    expect(arcsCommentsSchema.parse([])).toEqual([])
    expect(arcsCommentsSchema.safeParse({ items: [] }).success).toBe(false)
  })
  it('accepts documented optional user membership arrays and error envelopes', () => {
    const user = {
      userlogin: 'user',
      firstname: 'First',
      lastname: 'Last',
      email: 'user@example.com',
      applicationroles: [{ rolename: 'Viewer', id: 'role' }],
    }
    expect(arcsUsersSchema.parse({ status: 0, error: null, details: [user] }).details).toEqual([
      user,
    ])
    expect(
      arcsUsersSchema.parse({
        status: 1,
        error: { errorcode: 'EPMCSS-21193', errormessage: 'Unauthorized' },
        details: null,
      }).status
    ).toBe(1)
  })
  it('rejects unexpected response modes and malformed JSON shapes', () => {
    expect(() => parseArcsResponse(arcsJobSchema, { status: 200 })).toThrow(
      'unexpected response format'
    )
    expect(() => parseArcsResponse(arcsJobSchema, { status: 200, data: {} })).toThrow(
      'malformed response'
    )
  })
})
