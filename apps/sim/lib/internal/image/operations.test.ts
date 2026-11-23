import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import { uploadsExecutionMock } from '@sim/testing/mocks/uploads-execution.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getFalAIEstimatedCostMetadata: vi.fn(),
  getFalAIBillingReceipt: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)

vi.mock('@/lib/tools/falai-pricing', () => ({
  FALAI_COST_LOOKUP_TIMEOUT_MS: 10_000,
  getFalAIEstimatedCostMetadata: mocks.getFalAIEstimatedCostMetadata,
  getFalAIBillingReceipt: mocks.getFalAIBillingReceipt,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { executeImageGeneration } from '@/lib/internal/image/operations'
import { observeServiceCosts } from '@/lib/mothership/billing/service-observer'

const { mockInterruptibleSleep } = utilsHelpersMockFns

const { mockUploadCopilotFile } = uploadsCopilotMockFns

executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(9000)

const falInput = {
  provider: 'falai' as const,
  apiKey: 'fal-key',
  model: 'nano-banana-2',
  prompt: 'draw a safe bounded image',
}

describe('image operations', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.getFalAIEstimatedCostMetadata.mockReset()
    mocks.getFalAIBillingReceipt.mockReset().mockResolvedValue(undefined)
    mockSecureFetchWithPinnedIP.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
    mockInterruptibleSleep.mockResolvedValue(undefined)
    mockUploadCopilotFile.mockResolvedValue({ url: 'https://sim.test/generated.png' })
    // Content-derived queue URLs are validated and pinned; default to allowed.
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.1',
      originalHostname: 'queue.fal.run',
    })
  })

  it('submits a Fal.ai job once and only polls the created job', async () => {
    const inlineImage = `data:image/png;base64,${Buffer.from('png').toString('base64')}`
    // The job is created against the fixed public queue host over plain fetch.
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        request_id: 'job-1',
        status_url: 'https://queue.fal.run/status/job-1',
        response_url: 'https://queue.fal.run/result/job-1',
      })
    )
    // The response-derived status/result URLs are polled over the guarded path.
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(Response.json({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: inlineImage }] }))

    const response = await executeImageGeneration(falInput, {
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).imageUrl).toBe('https://sim.test/generated.png')
    expect(mocks.fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://queue.fal.run/fal-ai/nano-banana-2',
    ])
    expect(mockSecureFetchWithPinnedIP.mock.calls.map(([url]) => String(url))).toEqual([
      'https://queue.fal.run/status/job-1',
      'https://queue.fal.run/status/job-1',
      'https://queue.fal.run/result/job-1',
    ])
  })

  it('cancels the fal request when polling stops, without resubmitting or storing an image', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        request_id: 'job-2',
        status_url: 'https://queue.fal.run/status/job-2',
        response_url: 'https://queue.fal.run/result/job-2',
      })
    )
    mockInterruptibleSleep.mockImplementationOnce(async () => controller.abort())

    await expect(
      executeImageGeneration(falInput, {
        userId: 'user-1',
        requestId: 'request-2',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      expect.stringMatching(/^https:\/\/queue\.fal\.run\/.+\/requests\/job-2\/cancel$/),
      expect.objectContaining({ method: 'PUT' })
    )
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })

  it('rejects foreign fal queue hosts before sending credentials and cancels on the fal queue', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        request_id: 'foreign-job',
        status_url: 'https://untrusted.example/status',
      })
    )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(Response.json({ status: 'FAILED' }))

    const response = await executeImageGeneration(falInput, {
      userId: 'user-1',
      requestId: 'foreign-queue',
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Invalid Fal.ai queue URL' })
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      expect.stringMatching(/^https:\/\/queue\.fal\.run\/.+\/requests\/foreign-job\/cancel$/),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('retrieves nested fal jobs from the documented application request path', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ request_id: 'nested-job' }))
    mockSecureFetchWithPinnedIP.mockImplementation(async (url: string) => {
      if (url === 'https://queue.fal.run/fal-ai/bytedance/requests/nested-job/status') {
        return Response.json({ status: 'COMPLETED' })
      }
      if (url === 'https://queue.fal.run/fal-ai/bytedance/requests/nested-job') {
        return Response.json({ images: [{ url: 'data:image/png;base64,cG5n' }] })
      }
      return new Response('Not found', { status: 404 })
    })

    const response = await executeImageGeneration(
      { ...falInput, model: 'seedream-v4.5' },
      {
        userId: 'user-1',
        requestId: 'nested-queue',
      }
    )

    expect(response.status).toBe(200)
    expect((await response.json()).imageUrl).toBe('https://sim.test/generated.png')
  })

  it.each(['openai', 'gemini'])(
    'rejects a malformed typed %s model before any request',
    async (provider) => {
      const response = await executeImageGeneration(
        { ...falInput, provider, model: '../unknown model' },
        {
          userId: 'user-1',
          requestId: 'malformed-model',
        }
      )

      expect(response.status).toBe(400)
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )

  it('retains the completed fal receipt when delivery is interrupted', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValueOnce(Response.json({ request_id: 'paid-job' }))
    mocks.getFalAIBillingReceipt.mockImplementation(
      async ({ signal }: { signal?: AbortSignal }) => {
        signal?.throwIfAborted()
        return {
          requestId: 'paid-job',
          endpointId: 'fal-ai/nano-banana-2',
          costDollars: 0.1,
          source: 'billing_events',
        }
      }
    )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
    mockSecureFetchWithPinnedIP.mockImplementationOnce(async () => {
      controller.abort()
      return Response.json({ status: 'COMPLETED' })
    })

    await expect(
      executeImageGeneration(
        { ...falInput, useHostedCostTracking: true },
        {
          userId: 'user-1',
          requestId: 'completed-job',
          signal: controller.signal,
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.getFalAIBillingReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'paid-job' })
    )
    expect(mocks.getFalAIBillingReceipt.mock.calls[0][0].signal).toBeUndefined()
  })
  it.each([422, 500])(
    'reports HTTP %i generation failures without speculative delivery receipts',
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(Response.json({ request_id: 'rejected-job' }))
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
        .mockResolvedValueOnce(
          Response.json(
            {
              detail: [
                { type: 'no_media_generated', msg: 'secret-prompt', input: 'secret-prompt' },
              ],
            },
            { status }
          )
        )
      mocks.getFalAIEstimatedCostMetadata.mockResolvedValue({
        requestId: 'rejected-job',
        source: 'fallback_floor',
        costDollars: 0.05,
      })
      const receipts: string[] = []
      const response = await observeServiceCosts(
        async () => {},
        () =>
          executeImageGeneration(
            { ...falInput, useHostedCostTracking: true },
            { userId: 'user', requestId: 'rejected' }
          ),
        async (receipt) => {
          receipts.push(receipt)
        }
      )
      expect(response.status).toBe(status === 422 ? 422 : 502)
      const body = await response.json()
      expect(body.error).toContain('no_media_generated')
      expect(JSON.stringify(body)).not.toContain('secret-prompt')
      expect(JSON.stringify(getMockLogger('ImageOperations').error.mock.calls)).not.toContain(
        'secret-prompt'
      )
      expect(receipts).toEqual([])
      expect(mocks.getFalAIEstimatedCostMetadata).not.toHaveBeenCalled()
      expect(mockUploadCopilotFile).not.toHaveBeenCalled()
    }
  )

  it.each([
    { bytes: 32 * 1024 * 1024, declared: true, expected: 200 },
    { bytes: 101 * 1024 * 1024, declared: true, expected: 413 },
    { bytes: 101 * 1024 * 1024, declared: false, expected: 413 },
  ])(
    'bounds remote generated images ($bytes bytes, declared=$declared)',
    async ({ bytes, declared, expected }) => {
      mocks.fetch.mockResolvedValueOnce(Response.json({ request_id: 'large-image' }))
      let remaining = bytes
      const chunk = new Uint8Array(1024 * 1024)
      const binary = new Response(
        new ReadableStream({
          pull(controller) {
            if (remaining <= 0) {
              controller.close()
              return
            }
            controller.enqueue(chunk)
            remaining -= chunk.length
          },
        }),
        {
          headers: {
            'Content-Type': 'image/png',
            ...(declared ? { 'Content-Length': String(bytes) } : {}),
          },
        }
      )
      mockSecureFetchWithPinnedIP
        .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
        .mockResolvedValueOnce(
          Response.json({ images: [{ url: 'https://cdn.example/image.png' }] })
        )
        .mockResolvedValueOnce(binary)
      const response = await executeImageGeneration(falInput, {
        userId: 'user',
        requestId: 'large',
      })
      expect(response.status).toBe(expected)
      if (expected === 200) {
        expect(mockUploadCopilotFile.mock.calls[0][0].buffer.byteLength).toBe(bytes)
      } else {
        expect(mockUploadCopilotFile).not.toHaveBeenCalled()
      }
    }
  )
  it('reconciles exact image receipts when a completed queue status contains an error', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ request_id: 'image-queue-error' }))
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      Response.json({ status: 'COMPLETED', error: 'sensitive provider error' })
    )
    mocks.getFalAIBillingReceipt.mockResolvedValueOnce({
      requestId: 'image-queue-error',
      endpointId: 'fal-ai/nano-banana-2',
      source: 'billing_events',
      costDollars: 0.1,
    })
    const receipts: string[] = []
    const response = await observeServiceCosts(
      async () => {},
      () =>
        executeImageGeneration(
          { ...falInput, useHostedCostTracking: true },
          { userId: 'user', requestId: 'queue-error' }
        ),
      async (receipt) => {
        receipts.push(receipt)
      }
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(await response.json())).not.toContain('sensitive provider error')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toContain('0.1 (billing_events)')
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })
})
