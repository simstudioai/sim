/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { netsuiteSelectors } from '@/hooks/selectors/providers/netsuite/selectors'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const recordTypes = netsuiteSelectors['netsuite.recordTypes']
const asyncTasks = netsuiteSelectors['netsuite.asyncTasks']

function args(
  key: SelectorQueryArgs['key'],
  overrides: Partial<SelectorQueryArgs['context']> = {}
): SelectorQueryArgs {
  return {
    key,
    context: {
      oauthCredential: 'credential-1',
      workflowId: 'workflow-1',
      jobId: 'job-1',
      ...overrides,
    },
  }
}

describe('NetSuite selectors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers only the bounded record-type and async-task selectors', () => {
    expect(Object.keys(netsuiteSelectors)).toEqual(['netsuite.recordTypes', 'netsuite.asyncTasks'])
  })

  it('requires credential and workflow context, plus a job for async tasks', () => {
    expect(recordTypes.enabled?.(args('netsuite.recordTypes'))).toBe(true)
    expect(
      recordTypes.enabled?.(args('netsuite.recordTypes', { oauthCredential: undefined }))
    ).toBe(false)
    expect(recordTypes.enabled?.(args('netsuite.recordTypes', { workflowId: undefined }))).toBe(
      false
    )
    expect(asyncTasks.enabled?.(args('netsuite.asyncTasks'))).toBe(true)
    expect(asyncTasks.enabled?.(args('netsuite.asyncTasks', { jobId: undefined }))).toBe(false)
  })

  it('builds secret-free query keys scoped to every discovery dependency', () => {
    expect(recordTypes.getQueryKey(args('netsuite.recordTypes'))).toEqual([
      'selectors',
      'netsuite.recordTypes',
      'workflow-1',
      'credential-1',
    ])
    expect(asyncTasks.getQueryKey(args('netsuite.asyncTasks'))).toEqual([
      'selectors',
      'netsuite.asyncTasks',
      'workflow-1',
      'credential-1',
      'job-1',
    ])
    expect(JSON.stringify(asyncTasks.getQueryKey(args('netsuite.asyncTasks')))).not.toMatch(
      /accessToken|privateKey|certificateId/
    )
  })

  it.each([
    [
      recordTypes,
      args('netsuite.recordTypes'),
      {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        kind: 'record_types',
      },
    ],
    [
      asyncTasks,
      args('netsuite.asyncTasks'),
      {
        credential: 'credential-1',
        workflowId: 'workflow-1',
        kind: 'async_tasks',
        jobId: 'job-1',
      },
    ],
  ])(
    'posts exact bounded discovery context and forwards cancellation',
    async (selector, queryArgs, body) => {
      const controller = new AbortController()
      mockRequestJson.mockResolvedValueOnce({
        objects: [{ id: 'item-1', label: 'Item 1', detail: 'Provider detail' }],
      })

      const options = await selector.fetchList?.({ ...queryArgs, signal: controller.signal })

      expect(mockRequestJson).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/api/tools/netsuite/objects' }),
        { body, signal: controller.signal }
      )
      expect(options).toEqual([
        { id: 'item-1', label: 'Item 1', meta: { detail: 'Provider detail' } },
      ])
    }
  )

  it('resolves saved IDs from the same bounded list and skips incomplete context', async () => {
    mockRequestJson.mockResolvedValue({
      objects: [
        { id: 'task-1', label: 'Task 1', detail: null },
        { id: 'task-2', label: 'Task 2', detail: null },
      ],
    })

    expect(asyncTasks.resolvesUnknownIds).toBe(true)
    await expect(
      asyncTasks.fetchById?.({ ...args('netsuite.asyncTasks'), detailId: 'task-2' })
    ).resolves.toEqual({ id: 'task-2', label: 'Task 2' })
    expect(mockRequestJson).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    await expect(
      asyncTasks.fetchById?.({
        ...args('netsuite.asyncTasks', { jobId: undefined }),
        detailId: 'task-2',
      })
    ).resolves.toBeNull()
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
