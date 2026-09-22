/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getLegacyAccessRequestsQuery } from '@/ee/access-requests/lib/navigation'

describe('legacy access request navigation', () => {
  it('preserves review filters and selection without leaking permission group view state', () => {
    const query = getLegacyAccessRequestsQuery('access-control', {
      'access-view': 'requests',
      'request-id': 'request/a',
      'request-search': 'Tables and files',
      'request-page': '2',
      'request-status': 'declined',
      'group-id': 'group',
      search: 'Group search',
    })
    expect(query?.toString()).toBe(
      'request-id=request%2Fa&request-search=Tables+and+files&request-page=2&request-status=declined'
    )
  })

  it('uses the first tab value consistently with URL query parsing', () => {
    expect(
      getLegacyAccessRequestsQuery('access-control', { 'access-view': ['requests', 'groups'] })
    ).toBeInstanceOf(URLSearchParams)
    expect(
      getLegacyAccessRequestsQuery('access-control', { 'access-view': ['groups', 'requests'] })
    ).toBeNull()
  })

  it('leaves other settings and the permission groups view alone', () => {
    expect(getLegacyAccessRequestsQuery('access-control', {})).toBeNull()
    expect(getLegacyAccessRequestsQuery('access-control', { 'access-view': 'groups' })).toBeNull()
    expect(getLegacyAccessRequestsQuery('billing', { 'access-view': 'requests' })).toBeNull()
  })

  it('drops invalid review state through the canonical query parsers', () => {
    expect(
      getLegacyAccessRequestsQuery('access-control', {
        'access-view': 'requests',
        'request-page': '-1',
        'request-status': 'invalid',
        'request-id': '',
        'request-search': 'a'.repeat(201),
      })?.toString()
    ).toBe('')
  })
})
