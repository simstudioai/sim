/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))

import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

function args(
  key: Extract<SelectorKey, `netsuite.${string}`>,
  overrides: Partial<SelectorQueryArgs['context']> = {}
): SelectorQueryArgs {
  return {
    key,
    context: {
      workflowId: 'wf-1',
      oauthCredential: 'cred-1',
      ...overrides,
    },
  }
}

describe('NetSuite selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestJson.mockResolvedValue({ objects: [] })
  })

  it('registers all three bounded object selectors', () => {
    expect(getSelectorDefinition('netsuite.recordTypes').key).toBe('netsuite.recordTypes')
    expect(getSelectorDefinition('netsuite.datasets').key).toBe('netsuite.datasets')
    expect(getSelectorDefinition('netsuite.asyncTasks').key).toBe('netsuite.asyncTasks')
  })

  it('requires workflow and credential scope, plus a job for asynchronous tasks', () => {
    const recordTypes = getSelectorDefinition('netsuite.recordTypes')
    const tasks = getSelectorDefinition('netsuite.asyncTasks')

    expect(recordTypes.enabled?.(args('netsuite.recordTypes'))).toBe(true)
    expect(
      recordTypes.enabled?.(args('netsuite.recordTypes', { oauthCredential: undefined }))
    ).toBe(false)
    expect(recordTypes.enabled?.(args('netsuite.recordTypes', { workflowId: undefined }))).toBe(
      false
    )
    expect(tasks.enabled?.(args('netsuite.asyncTasks'))).toBe(false)
    expect(tasks.enabled?.(args('netsuite.asyncTasks', { jobId: 'job-7' }))).toBe(true)
  })

  it('uses secret-free, scope-complete query keys', () => {
    const recordTypes = getSelectorDefinition('netsuite.recordTypes')
    const tasks = getSelectorDefinition('netsuite.asyncTasks')

    expect(recordTypes.getQueryKey(args('netsuite.recordTypes'))).toEqual([
      'selectors',
      'netsuite.recordTypes',
      'wf-1',
      'cred-1',
    ])
    expect(tasks.getQueryKey(args('netsuite.asyncTasks', { jobId: 'job-7' }))).toEqual([
      'selectors',
      'netsuite.asyncTasks',
      'wf-1',
      'cred-1',
      'job-7',
    ])
    expect(
      JSON.stringify(tasks.getQueryKey(args('netsuite.asyncTasks', { jobId: 'job-7' })))
    ).not.toMatch(/accessToken|privateKey|certificateId/)
  })

  it('posts only selector scope, forwards cancellation, and maps normalized details', async () => {
    mocks.requestJson.mockResolvedValue({
      objects: [
        { id: '7', label: 'Accounts', detail: 'Record type: customer' },
        { id: '42', label: 'Orders', detail: null },
      ],
    })
    const signal = new AbortController().signal
    const selector = getSelectorDefinition('netsuite.datasets')

    const options = await selector.fetchList?.({ ...args('netsuite.datasets'), signal })

    expect(mocks.requestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/netsuite/objects' }),
      {
        body: {
          credential: 'cred-1',
          workflowId: 'wf-1',
          kind: 'datasets',
        },
        signal,
      }
    )
    expect(options).toEqual([
      { id: '7', label: 'Accounts', meta: { detail: 'Record type: customer' } },
      { id: '42', label: 'Orders' },
    ])
  })

  it('sends a job ID only for async task discovery', async () => {
    const selector = getSelectorDefinition('netsuite.asyncTasks')

    await selector.fetchList?.(args('netsuite.asyncTasks', { jobId: 'job-7' }))

    expect(mocks.requestJson).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        body: {
          credential: 'cred-1',
          workflowId: 'wf-1',
          kind: 'async_tasks',
          jobId: 'job-7',
        },
      })
    )
  })

  it('resolves saved IDs by filtering the same bounded list', async () => {
    mocks.requestJson.mockResolvedValue({
      objects: [
        { id: 'customer', label: 'customer', detail: null },
        { id: 'salesOrder', label: 'salesOrder', detail: null },
      ],
    })
    const selector = getSelectorDefinition('netsuite.recordTypes')

    await expect(
      selector.fetchById?.({ ...args('netsuite.recordTypes'), detailId: 'salesOrder' })
    ).resolves.toEqual({ id: 'salesOrder', label: 'salesOrder' })
    await expect(
      selector.fetchById?.({ ...args('netsuite.recordTypes'), detailId: 'missing' })
    ).resolves.toBeNull()
    expect(selector.resolvesUnknownIds).toBe(true)
  })

  it('fails before transport when required selector context is absent', async () => {
    const recordTypes = getSelectorDefinition('netsuite.recordTypes')
    const tasks = getSelectorDefinition('netsuite.asyncTasks')

    await expect(
      recordTypes.fetchList?.(args('netsuite.recordTypes', { oauthCredential: undefined }))
    ).rejects.toThrow(/Missing credential/)
    await expect(tasks.fetchList?.(args('netsuite.asyncTasks'))).rejects.toThrow(/Missing job ID/)
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })

  it('keeps search local instead of adding it to the provider request or cache key', async () => {
    const selector = getSelectorDefinition('netsuite.recordTypes')
    const selectorArgs = { ...args('netsuite.recordTypes'), search: 'cust' }

    await selector.fetchList?.(selectorArgs)

    expect(selector.getQueryKey(selectorArgs)).not.toContain('cust')
    expect(mocks.requestJson.mock.calls[0]?.[1]?.body).not.toHaveProperty('search')
  })
})
