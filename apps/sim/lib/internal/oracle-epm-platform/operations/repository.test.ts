/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrl } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrl: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mockSecureFetch,
  validateUrlWithDNS: mockValidateUrl,
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'

const auth = {
  oauthCredential: 'service-account-id',
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('operator:credential').toString('base64'),
}
const client = createOracleEpmClient(auth)
const context = { client }
beforeEach(() => {
  vi.clearAllMocks()
  mockValidateUrl.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  mockSecureFetch.mockImplementation(async () => Response.json({ status: 0 }))
})

import { repositoryOperations as operations } from '@/lib/internal/oracle-epm-platform/operations/repository'

describe('Oracle EPM repository and migration operations', () => {
  it('list_files preserves nullable snapshot size and decodes external-file metadata', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        items: [
          { name: 'Artifact Snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
          {
            name: 'inbox/data.csv',
            type: 'EXTERNAL',
            size: '123',
            lastmodifiedtime: '1770000000000',
          },
        ],
      })
    )
    expect(await operations.list_files(auth, context)).toMatchObject({
      files: [
        { name: 'Artifact Snapshot', type: 'LCM', size: null, lastModifiedTime: null },
        { name: 'inbox/data.csv', type: 'EXTERNAL', size: 123, lastModifiedTime: 1770000000000 },
      ],
    })
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/files/list'
    )
  })

  it('delete_file passes an explicit repository path in the v3 JSON body', async () => {
    await operations.delete_file({ ...auth, fileName: 'inbox/folder/report.csv' }, context)
    expect(mockSecureFetch).toHaveBeenCalledWith(
      'https://epm.example.com/gateway/interop/rest/v3/files/delete',
      '203.0.113.10',
      expect.objectContaining({ method: 'POST', body: '{"fileName":"inbox/folder/report.csv"}' })
    )
  })

  it('get_snapshot encodes the snapshot as one legacy path segment and projects capabilities', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: 0,
        items: [
          {
            name: 'Artifact Snapshot',
            type: 'LCM',
            canexport: true,
            canimport: true,
            canupload: false,
            candownload: true,
          },
        ],
      })
    )
    expect(
      await operations.get_snapshot({ ...auth, snapshotName: 'Artifact Snapshot' }, context)
    ).toMatchObject({
      snapshots: [
        {
          name: 'Artifact Snapshot',
          type: 'LCM',
          canExport: true,
          canImport: true,
          canUpload: false,
          canDownload: true,
        },
      ],
    })
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/11.1.2.3.600/applicationsnapshots/Artifact%20Snapshot'
    )
  })

  it('export_snapshot uses existing tenant settings and returns the migration job without polling', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: -1,
        links: [
          {
            rel: 'Job Status',
            action: 'GET',
            href: 'https://epm.example.com/gateway/interop/rest/v2/status/migration/41',
          },
        ],
      })
    )
    expect(
      await operations.export_snapshot({ ...auth, snapshotName: 'Configured Export' }, context)
    ).toMatchObject({
      status: -1,
      jobId: '41',
      jobKind: 'migration',
      completed: false,
    })
    expect(
      mockSecureFetch.mock.calls.map(([url, , options]) => [url, options.method, options.body])
    ).toEqual([
      [
        'https://epm.example.com/gateway/interop/rest/v2/snapshots/export',
        'POST',
        '{"snapshotName":"Configured Export"}',
      ],
    ])
  })

  it.each([
    { input: {}, parameters: { importUsers: 'FALSE' } },
    { input: { importUsers: true }, parameters: { importUsers: 'TRUE', resetPassword: 'TRUE' } },
    {
      input: { importUsers: true, resetPassword: false, userPassword: 'input-secret' },
      parameters: { importUsers: 'TRUE', resetPassword: 'FALSE', userPassword: 'input-secret' },
    },
  ])(
    'import_snapshot maps explicit import-user settings $parameters',
    async ({ input, parameters }) => {
      const result = await operations.import_snapshot(
        { ...auth, snapshotName: 'Artifact Snapshot', ...input },
        context
      )
      expect(result).toMatchObject({ status: 0, completed: true })
      expect(JSON.stringify(result)).not.toContain('input-secret')
      expect(mockSecureFetch).toHaveBeenCalledWith(
        'https://epm.example.com/gateway/interop/rest/v2/snapshots/import',
        '203.0.113.10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ snapshotName: 'Artifact Snapshot', parameters }),
        })
      )
    }
  )

  it('rename_snapshot stays synchronous and never guesses an asynchronous route', async () => {
    expect(
      await operations.rename_snapshot(
        { ...auth, snapshotName: 'Before', newSnapshotName: 'After' },
        context
      )
    ).toMatchObject({ status: 0 })
    expect(mockSecureFetch.mock.calls[0][2]).toMatchObject({
      method: 'PUT',
      body: '{"snapshotName":"Before","newSnapshotName":"After"}',
    })
    mockSecureFetch.mockImplementation(async () => Response.json({ status: -1 }))
    await expect(
      operations.rename_snapshot(
        { ...auth, snapshotName: 'Before', newSnapshotName: 'After' },
        context
      )
    ).rejects.toThrow('status -1')
  })

  it('list_migrations projects report counts without inventing nested message schemas', async () => {
    const item = {
      action: 'Export',
      duration: '1 sec',
      status: 'Success',
      user: 'operator',
      snapshot: 'Export',
      startTime: '2026-09-01 00:00:00',
      endTime: '2026-09-01 00:00:01',
      report: [
        {
          source: 'Application',
          destination: 'File System',
          status: 'Warning',
          errors: [],
          warnings: [{ code: 'W1', text: 'provider-specific', msgList: [] }],
        },
      ],
    }
    mockSecureFetch.mockImplementation(async () => Response.json({ status: 0, items: [item] }))
    const result = await operations.list_migrations(auth, context)
    expect(result.migrations).toEqual([
      {
        ...item,
        report: [
          {
            source: 'Application',
            destination: 'File System',
            status: 'Warning',
            errorCount: 0,
            warningCount: 1,
          },
        ],
      },
    ])
    expect(mockSecureFetch.mock.calls[0][0]).toBe(
      'https://epm.example.com/gateway/interop/rest/v2/migration/status'
    )
  })

  it('does not accept the contradictory POST method in Oracle migration-link examples', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: -1,
        links: [
          {
            rel: 'Job Status',
            action: 'POST',
            href: 'https://epm.example.com/gateway/interop/rest/v2/status/migration/41',
          },
        ],
      })
    )
    await expect(
      operations.export_snapshot({ ...auth, snapshotName: 'Export' }, context)
    ).rejects.toThrow()
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual(['POST'])
  })
})
