/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { listUserDevicesTool } from '@/tools/microsoft_ad/list_user_devices'

const buildUrl = listUserDevicesTool.request.url as (params: Record<string, unknown>) => string

const REGISTERED_NEXT_LINK =
  'https://graph.microsoft.com/v1.0/users/user-1/registeredDevices?$skiptoken=abc'
const OWNED_NEXT_LINK = 'https://graph.microsoft.com/v1.0/users/user-1/ownedDevices?$skiptoken=abc'

describe('listUserDevicesTool url', () => {
  it('builds the relationship path for the first page', () => {
    expect(buildUrl({ userId: 'user-1' })).toContain('/registeredDevices')
    expect(buildUrl({ userId: 'user-1', deviceRelationship: 'owned' })).toContain('/ownedDevices')
  })

  it('accepts a continuation URL for the selected relationship', () => {
    expect(buildUrl({ nextLink: REGISTERED_NEXT_LINK })).toContain('/registeredDevices')
    expect(buildUrl({ nextLink: OWNED_NEXT_LINK, deviceRelationship: 'owned' })).toContain(
      '/ownedDevices'
    )
  })

  /**
   * The Next Page field is shared across operations and keeps its value when the Device Link
   * dropdown changes. Accepting either relationship segment would silently keep paging the one
   * the user just switched away from.
   */
  it('rejects a continuation URL for the other relationship', () => {
    expect(() => buildUrl({ nextLink: REGISTERED_NEXT_LINK, deviceRelationship: 'owned' })).toThrow(
      /continues "registeredDevices", but this operation reads "ownedDevices"/
    )
    expect(() => buildUrl({ nextLink: OWNED_NEXT_LINK, deviceRelationship: 'registered' })).toThrow(
      /continues "ownedDevices", but this operation reads "registeredDevices"/
    )
  })

  it('rejects an unknown relationship before touching the continuation URL', () => {
    expect(() =>
      buildUrl({ nextLink: REGISTERED_NEXT_LINK, deviceRelationship: 'managed' })
    ).toThrow(/Device relationship must be "registered" or "owned"/)
  })
})
