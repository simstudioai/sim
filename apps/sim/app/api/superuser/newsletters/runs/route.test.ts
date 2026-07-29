/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateNewsletterRun, mockListNewsletterRuns, mockValidateNewsletterSuperuser } =
  vi.hoisted(() => ({
    mockCreateNewsletterRun: vi.fn(),
    mockListNewsletterRuns: vi.fn(),
    mockValidateNewsletterSuperuser: vi.fn(),
  }))

vi.mock('@/lib/newsletters/auth', () => ({
  validateNewsletterSuperuser: mockValidateNewsletterSuperuser,
}))

vi.mock('@/lib/newsletters/runs', () => ({
  createNewsletterRun: mockCreateNewsletterRun,
  listNewsletterRuns: mockListNewsletterRuns,
}))

import { NewsletterTargetingPromptError } from '@/lib/newsletters/targeting'
import { POST } from '@/app/api/superuser/newsletters/runs/route'

function createRequest(prompt = 'Everyone') {
  return createMockRequest('POST', {
    name: 'July launch',
    prompt,
  })
}

describe('newsletter runs POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateNewsletterSuperuser.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
  })

  it('returns the superuser authorization failure before creating a run', async () => {
    mockValidateNewsletterSuperuser.mockResolvedValue({
      success: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })

    const response = await POST(createRequest())

    expect(response.status).toBe(403)
    expect(mockCreateNewsletterRun).not.toHaveBeenCalled()
  })

  it('creates a preview run for an authorized superuser', async () => {
    const run = {
      id: 'run-1',
      name: 'July launch',
      prompt: 'Everyone',
    }
    mockCreateNewsletterRun.mockResolvedValue(run)

    const response = await POST(createRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ run })
    expect(mockCreateNewsletterRun).toHaveBeenCalledWith({
      name: 'July launch',
      prompt: 'Everyone',
      createdById: 'user-1',
    })
  })

  it('returns a client error for an ambiguous targeting prompt', async () => {
    mockCreateNewsletterRun.mockRejectedValue(new NewsletterTargetingPromptError())

    const response = await POST(createRequest('Users interested in productivity'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        'Targeting prompt is ambiguous. Use everyone, an Instagram integration or chat target, or a recent activity window.',
    })
  })
})
