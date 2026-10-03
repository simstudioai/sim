import { resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Keep the SDK transport real to verify signal forwarding and response validation. */
vi.unmock('@trigger.dev/core/v3')

import { apiClientManager } from '@trigger.dev/core/v3'
import { env } from '@/lib/core/config/env'
import { resetInsideTriggerRunForTests } from '@/lib/core/config/trigger-runtime'
import {
  type DocumentProcessingSnapshot,
  findAbandonedDocumentProcessing,
} from '@/lib/knowledge/documents/processing-recovery-queue'

const snapshot: DocumentProcessingSnapshot = {
  id: 'doc-1',
  uploadedAt: new Date('2026-09-01T00:00:00Z'),
  processingStatus: 'pending',
  processingQueueToken: 'generation-1',
  processingQueuedAt: new Date('2026-09-01T00:00:00Z'),
  processingStartedAt: null,
  processingDeferredUntil: null,
  processingCompletedAt: null,
  processingRecoveryAfter: null,
}
const originalSecret = env.TRIGGER_SECRET_KEY

function inspect(candidates: DocumentProcessingSnapshot[]) {
  return apiClientManager.runWithConfig(
    {
      baseURL: 'https://api.trigger.dev',
      accessToken: 'fixture-key',
      previewBranch: 'fixture-branch',
    },
    () => findAbandonedDocumentProcessing(candidates)
  )
}

beforeEach(() => {
  resetDbChainMock()
  resetInsideTriggerRunForTests()
  setEnvFlags({ isTriggerDevEnabled: true })
  env.TRIGGER_SECRET_KEY = 'fixture-key'
})
afterEach(() => {
  env.TRIGGER_SECRET_KEY = originalSecret
  resetEnvFlagsMock()
  vi.useRealTimers()
})

describe('document liveness SDK transport', () => {
  it('cancels the actual SDK HTTP requests at the deadline without accumulating requests', async () => {
    vi.useFakeTimers()
    let active = 0
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          active++
          init.signal!.addEventListener(
            'abort',
            () => {
              active--
              reject(init.signal!.reason)
            },
            { once: true }
          )
        })
    )
    vi.stubGlobal('fetch', fetch)
    const candidates = Array.from({ length: 20 }, (_, i) => ({ ...snapshot, id: `doc-${i}` }))
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = inspect(candidates)
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await result).toEqual([])
      expect(active).toBe(0)
      expect(fetch).toHaveBeenCalledTimes((attempt + 1) * 4)
    }
    const headers = new Headers(fetch.mock.calls[0][1].headers)
    expect(headers.get('Authorization')).toBe('Bearer fixture-key')
    expect(headers.get('x-trigger-branch')).toBe('fixture-branch')
  })

  it.each([true, false])(
    'validates the SDK response before declaring abandonment: valid=%s',
    async (valid) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(Response.json(valid ? { data: [], pagination: {} } : { data: [] }))
      vi.stubGlobal('fetch', fetch)
      expect(await inspect([snapshot])).toEqual(valid ? [snapshot] : [])
      expect(fetch).toHaveBeenCalledOnce()
      const url = new URL(fetch.mock.calls[0][0])
      expect(url.searchParams.get('page[size]')).toBe('1')
      expect(url.searchParams.get('filter[createdAt][from]')).toBe(
        String(new Date('2026-08-31T20:00:00Z').getTime())
      )
      expect(url.searchParams.get('filter[tag]')).toBe('documentId:doc-1')
    }
  )
})
