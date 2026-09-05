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

import { afterEach } from 'vitest'
import { getAdminJobStatus, projectJob } from '@/lib/internal/oracle-epm-platform/jobs'
import type { OracleEpmAdminJobKind } from '@/tools/oracle_epm_platform/types'

afterEach(() => vi.useRealTimers())

describe('Oracle EPM administrative jobs', () => {
  it.each([
    ['migration', 'v2/status/migration'],
    ['maintenance', 'v2/status/service/maintenancewindow'],
    ['snapshot_upload', 'v1/services/jobs'],
  ] as const)('reads %s status once by default', async (jobKind, path) => {
    mockSecureFetch.mockImplementation(async () => Response.json({ status: -1 }))
    expect(await getAdminJobStatus(client, { jobKind, jobId: '12' })).toMatchObject({
      status: -1,
      completed: false,
      jobId: '12',
      jobKind,
    })
    expect(mockSecureFetch.mock.calls.map(([url, , options]) => [url, options.method])).toEqual([
      [`https://epm.example.com/gateway/interop/rest/${path}/12`, 'GET'],
    ])
  })

  it('projects completed migration task summaries without exposing provider links', async () => {
    mockSecureFetch.mockImplementation(async () =>
      Response.json({
        status: '0',
        items: [
          {
            name: 'Artifact',
            source: 'App',
            destination: 'File System',
            links: [{ href: 'private-link' }],
          },
        ],
      })
    )
    expect(await getAdminJobStatus(client, { jobKind: 'migration', jobId: '12' })).toEqual({
      status: 0,
      message: 'Operation completed',
      completed: true,
      jobId: '12',
      jobKind: 'migration',
      tasks: [{ name: 'Artifact', source: 'App', destination: 'File System' }],
    })
  })

  it.each([0, 7])('waits through progress and returns terminal status %s', async (terminal) => {
    vi.useFakeTimers()
    mockSecureFetch
      .mockImplementationOnce(async () => Response.json({ status: -1 }))
      .mockImplementationOnce(async () => Response.json({ status: terminal }))
    const pending = getAdminJobStatus(client, {
      jobKind: 'maintenance',
      jobId: '12',
      waitForCompletion: true,
    })
    const checked = expect(pending).resolves.toMatchObject({
      status: terminal,
      completed: true,
      jobId: '12',
    })
    await vi.advanceTimersByTimeAsync(5000)
    await checked
    expect(mockSecureFetch.mock.calls.map(([, , options]) => options.method)).toEqual([
      'GET',
      'GET',
    ])
  })

  it('bounds optional waiting and preserves cancellation', async () => {
    vi.useFakeTimers()
    mockSecureFetch.mockImplementation(async () => Response.json({ status: -1 }))
    const pending = getAdminJobStatus(client, {
      jobKind: 'maintenance',
      jobId: '12',
      waitForCompletion: true,
    })
    const checked = expect(pending).rejects.toThrow(/deadline|attempt limit/)
    await vi.advanceTimersByTimeAsync(120_000)
    await checked
    expect(mockSecureFetch.mock.calls.length).toBeLessThanOrEqual(40)

    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    mockSecureFetch.mockClear()
    await expect(
      getAdminJobStatus(
        client,
        { jobKind: 'maintenance', jobId: '12', waitForCompletion: true },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it('aborts an in-progress status read', async () => {
    const controller = new AbortController()
    mockSecureFetch.mockImplementation(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      return Response.json({ status: -1 })
    })
    await expect(
      getAdminJobStatus(
        client,
        { jobKind: 'snapshot_upload', jobId: '12', waitForCompletion: true },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([
    {
      rel: 'Job Status',
      action: 'POST',
      href: 'https://epm.example.com/gateway/interop/rest/v2/status/migration/12',
    },
    {
      rel: "Job' 'Status",
      action: 'GET',
      href: 'https://epm.example.com/gateway/interop/rest/v2/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: ' https://epm.example.com/gateway/interop/rest/v2/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'http://epm.example.com/gateway/interop/rest/v2/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://other.example.com/gateway/interop/rest/v2/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://epm.example.com/interop/rest/v2/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://epm.example.com/gateway/interop/rest/v1/status/migration/12',
    },
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://epm.example.com/gateway/interop/rest/security/v2/status/migration/12',
    },
  ])('rejects contradictory or out-of-policy job links: $href $action $rel', (link) => {
    expect(() => projectJob(client, { status: -1, links: [link] }, 'migration')).toThrow()
    expect(mockSecureFetch).not.toHaveBeenCalled()
  })

  it.each(['migration', 'maintenance', 'snapshot_upload'] as OracleEpmAdminJobKind[])(
    'never requires a link for immediate %s success',
    (kind) => {
      expect(projectJob(client, { status: 0 }, kind)).toEqual({
        status: 0,
        message: 'Operation completed',
        completed: true,
      })
    }
  )

  it('rejects ambiguous multiple status links', () => {
    const link = {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://epm.example.com/gateway/interop/rest/v2/status/migration/12',
    }
    expect(() => projectJob(client, { status: -1, links: [link, link] }, 'migration')).toThrow(
      'unexpected response'
    )
  })
})
