/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFinalizeNewsletterRun, mockValidateNewsletterSuperuser } = vi.hoisted(() => ({
  mockFinalizeNewsletterRun: vi.fn(),
  mockValidateNewsletterSuperuser: vi.fn(),
}))

vi.mock('@/lib/newsletters/auth', () => ({
  validateNewsletterSuperuser: mockValidateNewsletterSuperuser,
}))

vi.mock('@/lib/newsletters/runs', () => ({
  finalizeNewsletterRun: mockFinalizeNewsletterRun,
}))

import { NewsletterResendError } from '@/lib/newsletters/resend'
import { POST } from '@/app/api/superuser/newsletters/runs/[id]/finalize/route'

function callRoute() {
  const request = createMockRequest(
    'POST',
    undefined,
    {},
    'http://localhost:3000/api/superuser/newsletters/runs/run-1/finalize'
  )
  return POST(request, { params: Promise.resolve({ id: 'run-1' }) })
}

describe('newsletter run finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateNewsletterSuperuser.mockResolvedValue({
      success: true,
      userId: 'admin-1',
    })
  })

  it.each([
    'Resend suppression pagination returned no cursor',
    'Resend contact pagination returned no cursor',
    'Resend contact property pagination returned no cursor',
  ])('maps a Resend service failure to 503: %s', async (message) => {
    mockFinalizeNewsletterRun.mockRejectedValueOnce(new NewsletterResendError(message))

    const response = await callRoute()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: message })
  })

  it('does not classify an unrelated error by message text', async () => {
    mockFinalizeNewsletterRun.mockRejectedValueOnce(new Error('Resend text from unrelated code'))

    const response = await callRoute()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
