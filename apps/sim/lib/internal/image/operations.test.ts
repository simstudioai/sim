import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { uploadsCopilotMock, uploadsCopilotMockFns } from '@sim/testing/mocks/uploads-copilot.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getFalAICostMetadata: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetch)

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)

vi.mock('@/lib/tools/falai-pricing', () => ({
  getFalAICostMetadata: mocks.getFalAICostMetadata,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => uploadsCopilotMock)

vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { executeImageGeneration } from '@/lib/internal/image/operations'

const { mockInterruptibleSleep } = utilsHelpersMockFns

const { mockUploadCopilotFile } = uploadsCopilotMockFns

executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(9000)

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const falInput = {
  provider: 'falai' as const,
  apiKey: 'fal-key',
  model: 'nano-banana-2',
  prompt: 'draw a safe bounded image',
}

describe('image operations', () => {
  beforeEach(() => {
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

  it('cancels polling without resubmitting or storing an image', async () => {
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

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(mockUploadCopilotFile).not.toHaveBeenCalled()
  })
})
