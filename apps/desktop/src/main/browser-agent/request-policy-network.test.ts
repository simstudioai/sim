import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ default: { lookup: mockLookup } }))

import { allowBrowserRequest } from '@/main/browser-agent/request-policy'
import { clearHostVerdictCache } from '@/main/browser-agent/url-guard'

type ResourceType = Parameters<typeof allowBrowserRequest>[0]['resourceType']

describe('browser requests with the network guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearHostVerdictCache()
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it.each(['script', 'font'] as const)(
    'blocks non-web %s URLs independently of DNS',
    async (type) => {
      for (const url of [
        'file:///etc/passwd',
        'chrome://settings/',
        'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x.js',
      ]) {
        expect(await allowBrowserRequest({ url, method: 'GET', resourceType: type }), url).toBe(
          false
        )
      }
      expect(mockLookup).not.toHaveBeenCalled()
    }
  )

  it.each<[string, ResourceType]>([
    ['http://example.com/', 'mainFrame'],
    ['https://example.com/frame', 'subFrame'],
    ['https://example.com/app.js', 'script'],
    ['https://example.com/image.png', 'image'],
    ['https://example.com/font.woff2', 'font'],
    ['http://localhost:3000/app.js', 'script'],
    ['http://127.0.0.1:3000/app.css', 'stylesheet'],
    ['ws://example.com/socket', 'webSocket'],
    ['wss://example.com/socket', 'webSocket'],
    ['data:image/png;base64,aGVsbG8=', 'image'],
    ['blob:https://example.com/image-id', 'image'],
    ['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'subFrame'],
    ['chrome://resources/js/assert.js', 'script'],
  ])('preserves %s as a %s', async (url, resourceType) => {
    expect(await allowBrowserRequest({ url, method: 'GET', resourceType })).toBe(true)
  })

  it.each(['mainFrame', 'subFrame'] as const)(
    'keeps data, blob, and websocket URLs out of %s navigations',
    async (resourceType) => {
      for (const url of [
        'data:text/html,hello',
        'blob:https://example.com/id',
        'ws://example.com',
      ]) {
        expect(await allowBrowserRequest({ url, method: 'GET', resourceType })).toBe(false)
      }
      expect(mockLookup).not.toHaveBeenCalled()
    }
  )

  it.each<[string, ResourceType]>([
    ['http://169.254.169.254/latest/meta-data', 'xhr'],
    ['http://169.254.169.254/font.woff2', 'font'],
    ['http://[fd00::1]/image.png', 'image'],
    ['ws://10.0.0.1/socket', 'webSocket'],
    ['wss://internal.example/socket', 'webSocket'],
    ['https://internal.example/app.js', 'script'],
  ])('still blocks private network request %s', async (url, resourceType) => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    expect(await allowBrowserRequest({ url, method: 'GET', resourceType })).toBe(false)
  })
})
