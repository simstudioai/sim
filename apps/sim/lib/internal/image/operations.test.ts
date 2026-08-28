/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  interruptibleSleep: vi.fn(),
  uploadCopilotFile: vi.fn(),
  uploadExecutionFile: vi.fn(),
  getFalAICostMetadata: vi.fn(),
}))

vi.stubGlobal('fetch', mocks.fetch)

vi.mock('@sim/utils/helpers', () => ({
  interruptibleSleep: mocks.interruptibleSleep,
}))

vi.mock('@/lib/core/execution-limits', () => ({
  getMaxExecutionTimeout: () => 9000,
}))

vi.mock('@/lib/tools/falai-pricing', () => ({
  getFalAICostMetadata: mocks.getFalAICostMetadata,
}))

vi.mock('@/lib/uploads/contexts/copilot', () => ({
  uploadCopilotFile: mocks.uploadCopilotFile,
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))

import { executeImageGeneration } from '@/lib/internal/image/operations'

const falInput = {
  provider: 'falai' as const,
  apiKey: 'fal-key',
  model: 'nano-banana-2',
  prompt: 'draw a safe bounded image',
}

describe('image operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.interruptibleSleep.mockResolvedValue(undefined)
    mocks.uploadCopilotFile.mockResolvedValue({ url: 'https://sim.test/generated.png' })
  })

  it('submits a Fal.ai job once and only polls the created job', async () => {
    const inlineImage = `data:image/png;base64,${Buffer.from('png').toString('base64')}`
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({
          request_id: 'job-1',
          status_url: 'https://queue.fal.run/status/job-1',
          response_url: 'https://queue.fal.run/result/job-1',
        })
      )
      .mockResolvedValueOnce(Response.json({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ images: [{ url: inlineImage }] }))

    const response = await executeImageGeneration(falInput, {
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).imageUrl).toBe('https://sim.test/generated.png')
    const urls = mocks.fetch.mock.calls.map(([url]) => String(url))
    expect(urls.filter((url) => url === 'https://queue.fal.run/fal-ai/nano-banana-2')).toHaveLength(
      1
    )
    expect(urls).toEqual([
      'https://queue.fal.run/fal-ai/nano-banana-2',
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
    mocks.interruptibleSleep.mockImplementationOnce(async () => controller.abort())

    await expect(
      executeImageGeneration(falInput, {
        userId: 'user-1',
        requestId: 'request-2',
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.uploadCopilotFile).not.toHaveBeenCalled()
  })
})
