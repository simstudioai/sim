import { describe, expect, it } from 'vitest'
import {
  buildIntuneActionUrl,
  buildIntuneCollectionUrl,
  buildIntuneResourcePath,
} from '@/tools/intune/utils'

const DEVICE_PATH = 'managedDevices'
const APP_DEVICE_PATH = 'detectedApps/app-1/managedDevices'

describe('Intune credential destination and pagination', () => {
  it.each([
    'https://attacker.example/v1.0/deviceManagement/managedDevices?$skiptoken=abc',
    'http://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=abc',
    'https://user:password@graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=abc',
    'https://graph.microsoft.com/beta/deviceManagement/managedDevices?$skiptoken=abc',
    'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
    'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/one?$skiptoken=abc',
    'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=abc#ignored',
  ])('rejects unsafe continuation URL %s', (nextLink) => {
    expect(() => buildIntuneCollectionUrl(DEVICE_PATH, { nextLink })).toThrow()
  })

  it('rejects a continuation URL belonging to a different parent resource', () => {
    expect(() =>
      buildIntuneCollectionUrl(APP_DEVICE_PATH, {
        nextLink:
          'https://graph.microsoft.com/v1.0/deviceManagement/detectedApps/app-2/managedDevices?$skiptoken=abc',
      })
    ).toThrow()
  })

  it('preserves the opaque continuation query without adding first-page filters', () => {
    const nextLink =
      'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=a%2Bb%3D&$top=25'
    expect(buildIntuneCollectionUrl(DEVICE_PATH, { nextLink, top: 50 })).toBe(nextLink)
  })

  it.each([0, -1, 1001, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid page size %s',
    (top) => {
      expect(() => buildIntuneCollectionUrl(DEVICE_PATH, { top })).toThrow()
    }
  )

  it.each(['.', '..', 'x/y', 'x\\y', '%2e%2e', ''])('rejects path traversal ID %s', (id) => {
    expect(() => buildIntuneResourcePath('managedDevices', id)).toThrow()
  })
})

describe('Intune disruptive device actions', () => {
  it.each(['rebootNow', 'remoteLock', 'retire'] as const)(
    'requires explicit confirmation for %s',
    (action) => {
      for (const confirmation of [undefined, false, 'true', 1]) {
        expect(() => buildIntuneActionUrl('device-1', action, confirmation)).toThrow(/confirm/i)
      }
      expect(buildIntuneActionUrl('device-1', action, true)).toMatch(
        /https:\/\/graph\.microsoft\.com\/v1\.0\/deviceManagement\/managedDevices\/device-1\//
      )
    }
  )
})
