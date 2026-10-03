/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  filesSchema,
  groupReportSchema,
  groupsSchema,
  idleTimeoutSchema,
  migrationsSchema,
  OracleEpmPlatformResponseError,
  parseResponse,
  projectBatch,
  readStatus,
  requireSuccess,
  snapshotsSchema,
  usersSchema,
  virusScanSchema,
} from '@/lib/internal/oracle-epm-platform/responses'

describe('Oracle EPM Platform documented response projection', () => {
  it.each([0, '0', -1, '-1', 8, '8'])('reads the documented numeric/string status %j', (value) => {
    expect(readStatus({ status: value })).toBe(Number(value))
  })
  it.each([null, {}, '', '0junk', true, '-2', 0.5, Number.NaN])(
    'rejects malformed status %j without exposing the response',
    (status) => {
      expect(() => readStatus({ status, password: 'sensitive-value' })).toThrow(
        OracleEpmPlatformResponseError
      )
      try {
        readStatus({ status, details: 'sensitive-value' })
      } catch (error) {
        expect(String(error)).not.toContain('sensitive-value')
      }
    }
  )
  it('does not treat asynchronous progress as synchronous success', () => {
    expect(() => requireSuccess({ status: -1 })).toThrow('status -1')
  })
  it('projects integer strings and true/false strings, not JavaScript truthiness', () => {
    expect(parseResponse(idleTimeoutSchema, { items: [{ timeout: '30' }] }).items[0].timeout).toBe(
      30
    )
    expect(
      parseResponse(virusScanSchema, { items: [{ scanfiles: 'false' }] }).items[0].scanfiles
    ).toBe(false)
    expect(() => parseResponse(virusScanSchema, { items: [{ scanfiles: 'FALSE' }] })).toThrow()
    expect(() => parseResponse(idleTimeoutSchema, { items: [{ timeout: '30 minutes' }] })).toThrow()
  })
  it('preserves null LCM sizes and converts documented external file timestamps', () => {
    const { items } = parseResponse(filesSchema, {
      items: [
        { name: 'Artifact Snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
        { name: 'inbox/data.csv', type: 'EXTERNAL', size: '18', lastmodifiedtime: '1422534438000' },
      ],
    })
    expect(items).toEqual([
      { name: 'Artifact Snapshot', type: 'LCM', size: null, lastModifiedTime: null },
      { name: 'inbox/data.csv', type: 'EXTERNAL', size: 18, lastModifiedTime: 1422534438000 },
    ])
    expect(() =>
      parseResponse(filesSchema, {
        items: [
          { name: 'file', type: 'EXTERNAL', size: '9007199254740992', lastmodifiedtime: null },
        ],
      })
    ).toThrow()
  })
  it('strips unknown/password fields and does not invent unrequested identity expansions', () => {
    const result = parseResponse(usersSchema, {
      details: [
        {
          userlogin: 'jdoe',
          firstname: '',
          lastname: 'Doe',
          email: 'jane@example.com',
          password: 'secret',
        },
      ],
    })
    expect(result.details[0]).toEqual({
      userlogin: 'jdoe',
      firstname: '',
      lastname: 'Doe',
      email: 'jane@example.com',
    })
    expect(parseResponse(usersSchema, { details: [] }).details).toEqual([])
    expect(() => parseResponse(usersSchema, { details: null })).toThrow()
  })
  it('keeps documented group membership and product-defined role names', () => {
    expect(
      parseResponse(groupsSchema, {
        details: [
          {
            groupname: 'Finance',
            description: '',
            type: 'EPM',
            identity: 'native://group',
            members: { users: [], groups: [] },
            roles: [{ rolename: 'Tenant application role', id: 'HP:001' }],
          },
        ],
      }).details[0]
    ).toMatchObject({
      members: { users: [], groups: [] },
      roles: [{ rolename: 'Tenant application role', id: 'HP:001' }],
    })
    expect(
      parseResponse(groupReportSchema, {
        details: [
          {
            userlogin: 'jdoe',
            firstname: '',
            lastname: 'Doe',
            email: 'jane@example.com',
            groups: [{ groupname: 'Finance', direct: 'No' }],
          },
        ],
      }).details[0].groups[0].direct
    ).toBe(false)
  })
  it('surfaces partial item failure despite outer status zero and removes password echoes', () => {
    const result = projectBatch({
      status: 0,
      error: null,
      details: {
        processed: 2,
        succeeded: 1,
        failed: 1,
        faileditems: [
          {
            userlogin: 'jdoe',
            errorcode: 'EPMCSS-21150',
            errormessage: 'Password is sensitive-value',
            password: 'sensitive-value',
          },
        ],
      },
    })
    expect(result).toMatchObject({
      status: 0,
      processed: 2,
      succeeded: 1,
      failed: 1,
      partialFailure: true,
      failedItems: [{ userlogin: 'jdoe', errorcode: 'EPMCSS-21150' }],
    })
    expect(JSON.stringify(result)).not.toContain('sensitive-value')
  })
  it('preserves nested group-member failure identifiers/codes without raw error text', () => {
    const result = projectBatch({
      status: 0,
      error: null,
      details: {
        processed: 1,
        succeeded: 0,
        failed: 1,
        faileditems: [
          {
            groupname: 'Finance',
            errorcode: 'EPMCSS-21231',
            erroritems: {
              users: [{ userlogin: 'missing', errorcode: 'EPMCSS-21230', errormessage: 'private' }],
            },
          },
        ],
      },
    })
    expect(result.failedItems[0].erroritems?.users).toEqual([
      { userlogin: 'missing', errorcode: 'EPMCSS-21230' },
    ])
  })
  it('handles whole-batch rejection without inventing processed counts', () => {
    expect(
      projectBatch({
        status: 1,
        error: { errorcode: 'EPMCSS-21146', errormessage: 'secret' },
        details: null,
      })
    ).toMatchObject({
      status: 1,
      processed: null,
      failed: null,
      partialFailure: false,
      errorCode: 'EPMCSS-21146',
    })
  })
  it.each([
    { status: 0, error: null, details: null },
    { status: 0, error: null, details: { processed: 2, succeeded: 2, failed: 1, faileditems: [] } },
    {
      status: 0,
      error: null,
      details: { processed: 1, succeeded: 0, failed: 1, faileditems: null },
    },
  ])('rejects a malformed or contradictory batch result', (value) => {
    expect(() => projectBatch(value)).toThrow(OracleEpmPlatformResponseError)
  })
  it('projects snapshot capabilities from documented lower-case and camel-case examples', () => {
    const lower = {
      name: 'Artifact Snapshot',
      type: 'LCM',
      canexport: true,
      canimport: true,
      canupload: false,
      candownload: true,
    }
    const projected = parseResponse(snapshotsSchema, { items: [lower] }).items[0]
    expect(projected).toEqual({
      name: 'Artifact Snapshot',
      type: 'LCM',
      canExport: true,
      canImport: true,
      canUpload: false,
      canDownload: true,
    })
    expect(parseResponse(snapshotsSchema, { items: [projected] }).items[0]).toEqual(projected)
  })
  it('projects migration report counts without inventing undocumented nested message schemas', () => {
    const result = parseResponse(migrationsSchema, {
      items: [
        {
          action: 'export',
          duration: '00:00:03',
          status: 'completedWithWarnings',
          user: 'SYSTEM',
          snapshot: 'Artifact Snapshot',
          endTime: '02/18/2026 04:26:05',
          startTime: '02/18/2026 04:25:31',
          report: [
            {
              destination: 'Planning',
              source: 'Vision',
              status: 'processed',
              errors: [],
              warnings: [{ code: 'example', text: 'Not projected', msgList: [] }],
            },
          ],
        },
      ],
    })
    expect(result.items[0].report).toEqual([
      {
        destination: 'Planning',
        source: 'Vision',
        status: 'processed',
        errorCount: 0,
        warningCount: 1,
      },
    ])
    expect(JSON.stringify(result)).not.toContain('Not projected')
  })
})
