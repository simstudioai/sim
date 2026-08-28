/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const client = {
    service: vi.fn((path: string) => `service:${path}`),
    forms: vi.fn((path: string) => `forms:${path}`),
    assets: vi.fn((path: string) => `assets:${path}`),
    json: vi.fn(),
    value: vi.fn(),
    empty: vi.fn(),
    optionalJson: vi.fn(),
  }
  return {
    client,
    createJsmClient: vi.fn(async () => client),
    createJsmAssetsClient: vi.fn(async () => client),
    mapAssetObject: vi.fn((value: unknown) => value),
  }
})

vi.mock('@/lib/internal/jsm/client', () => ({
  asArray: (value: unknown) => (Array.isArray(value) ? value : []),
  asObject: (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {},
  nested: (value: unknown, ...keys: string[]) => {
    let current = value
    for (const key of keys) {
      current =
        current && typeof current === 'object' && !Array.isArray(current)
          ? (current as Record<string, unknown>)[key]
          : undefined
    }
    return current
  },
  createJsmClient: mocks.createJsmClient,
  createJsmAssetsClient: mocks.createJsmAssetsClient,
}))

vi.mock('@/tools/jsm/utils', () => ({ mapAssetObject: mocks.mapAssetObject }))

import { executeJsmSearchObjectsAql } from '@/lib/internal/jsm/assets'
import { executeJsmSubmitForm } from '@/lib/internal/jsm/forms'
import { executeJsmCreateRequest, listJsmServiceDeskOptions } from '@/lib/internal/jsm/service-desk'

const BASE = {
  domain: 'example.atlassian.net',
  accessToken: 'token',
  cloudId: '12345678-1234-1234-1234-123456789012',
}

describe('JSM operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drains selector pages using the number of returned rows as the next offset', async () => {
    mocks.client.json
      .mockResolvedValueOnce({
        values: [{ id: '1', projectName: 'One' }],
        _links: { next: 'next' },
      })
      .mockResolvedValueOnce({ values: [{ id: '2', projectName: 'Two' }], isLastPage: true })

    await expect(listJsmServiceDeskOptions(BASE)).resolves.toEqual([
      { id: '1', name: 'One' },
      { id: '2', name: 'Two' },
    ])
    expect(mocks.client.json).toHaveBeenNthCalledWith(
      1,
      'service:/servicedesk?start=0&limit=100',
      {},
      undefined
    )
    expect(mocks.client.json).toHaveBeenNthCalledWith(
      2,
      'service:/servicedesk?start=1&limit=100',
      {},
      undefined
    )
  })

  it('keeps form answers separate from explicitly supplied request field values', async () => {
    mocks.client.json.mockResolvedValueOnce({ issueKey: 'HELP-1' })
    await executeJsmCreateRequest({
      ...BASE,
      serviceDeskId: '1',
      requestTypeId: '2',
      summary: 'Do not duplicate this linked form field',
      formAnswers: { q1: 'yes' },
      requestFieldValues: { customfield_1: 'safe' },
    })
    const init = mocks.client.json.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      serviceDeskId: '1',
      requestTypeId: '2',
      form: { answers: { q1: 'yes' } },
      requestFieldValues: { customfield_1: 'safe' },
    })
  })

  it('uses the Forms action endpoint and preserves its empty-body default', async () => {
    mocks.client.optionalJson.mockResolvedValueOnce({})
    const result = await executeJsmSubmitForm({
      ...BASE,
      issueIdOrKey: 'HELP-1',
      formId: '12345678-1234-1234-1234-123456789012',
    })
    expect(mocks.client.optionalJson).toHaveBeenCalledWith(
      'forms:/issue/HELP-1/form/12345678-1234-1234-1234-123456789012/action/submit',
      { method: 'PUT' },
      undefined,
      true
    )
    expect(result.output.status).toBe('submitted')
  })

  it('normalizes Assets AQL pagination and forwards the execution signal', async () => {
    const controller = new AbortController()
    mocks.client.json.mockResolvedValueOnce({ objectEntries: [{ id: 'object-1' }] })
    await executeJsmSearchObjectsAql(
      { ...BASE, qlQuery: 'objectType = Host', page: '2', resultsPerPage: '10' },
      controller.signal
    )
    expect(mocks.createJsmAssetsClient).toHaveBeenCalledWith(
      expect.objectContaining({ qlQuery: 'objectType = Host' }),
      controller.signal
    )
    expect(mocks.client.json).toHaveBeenCalledWith(
      'assets:/object/aql',
      {
        method: 'POST',
        body: JSON.stringify({
          qlQuery: 'objectType = Host',
          page: 2,
          resultsPerPage: 10,
          includeAttributes: true,
        }),
      },
      controller.signal,
      true
    )
  })
})
