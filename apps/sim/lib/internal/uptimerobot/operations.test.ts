/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendUptimeRobotPspImage: vi.fn(),
  requestUptimeRobotPsp: vi.fn(),
}))

vi.mock('@/lib/internal/uptimerobot/client', () => ({
  requestUptimeRobotPsp: mocks.requestUptimeRobotPsp,
}))

vi.mock('@/lib/internal/uptimerobot/file-input', () => ({
  appendUptimeRobotPspImage: mocks.appendUptimeRobotPspImage,
}))

import { createUptimeRobotPsp, updateUptimeRobotPsp } from '@/lib/internal/uptimerobot/operations'

const PSP = {
  id: 1,
  friendlyName: 'Status',
  customDomain: null,
  isPasswordSet: null,
  monitorIds: [],
  tagIds: [],
  monitorsCount: null,
  status: null,
  urlKey: null,
  homepageLink: null,
  gaCode: null,
  icon: null,
  logo: null,
  noIndex: null,
  hideUrlLinks: null,
  subscription: null,
}

describe('UptimeRobot PSP operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestUptimeRobotPsp.mockResolvedValue(PSP)
  })

  it('builds create multipart input and authorizes each provided image', async () => {
    const controller = new AbortController()
    const logo = { key: 'logo-key' }
    const icon = { key: 'icon-key' }

    const result = await createUptimeRobotPsp(
      {
        apiKey: 'key',
        friendlyName: 'Status',
        monitorIds: '1, 2, ,3',
        hideUrlLinks: false,
        noIndex: true,
        logo,
        icon,
      },
      {
        userId: 'user-1',
        requestId: 'request-1',
        signal: controller.signal,
      }
    )

    expect(result).toEqual({ success: true, output: { psp: PSP } })
    expect(mocks.appendUptimeRobotPspImage).toHaveBeenCalledTimes(2)
    const providerCall = mocks.requestUptimeRobotPsp.mock.calls[0][0]
    expect(providerCall).toMatchObject({
      apiKey: 'key',
      method: 'POST',
      path: '/psps',
      signal: controller.signal,
    })
    expect(providerCall.form.getAll('monitorIds')).toEqual(['1', '2', '3'])
    expect(providerCall.form.get('hideUrlLinks')).toBe('false')
    expect(providerCall.form.get('noIndex')).toBe('true')
  })

  it('uses the canonical update path and omits absent fields', async () => {
    await updateUptimeRobotPsp(
      { apiKey: 'key', pspId: 42 },
      { userId: 'user-1', requestId: 'request-1' }
    )

    const providerCall = mocks.requestUptimeRobotPsp.mock.calls[0][0]
    expect(providerCall).toMatchObject({ apiKey: 'key', method: 'PATCH', path: '/psps/42' })
    expect([...providerCall.form.entries()]).toEqual([])
  })

  it('stops before file or provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      createUptimeRobotPsp(
        { apiKey: 'key', friendlyName: 'Status' },
        {
          userId: 'user-1',
          requestId: 'request-1',
          signal: controller.signal,
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.appendUptimeRobotPspImage).not.toHaveBeenCalled()
    expect(mocks.requestUptimeRobotPsp).not.toHaveBeenCalled()
  })
})
