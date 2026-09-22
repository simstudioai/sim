/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  getAccessRequestsSettingsHref,
  getLegacyAccessRequestsQuery,
  getLegacyAccessRequestsSettingsQuery,
  getMyAccessRequestHref,
} from '@/ee/access-requests/lib/navigation'

describe('requests settings navigation', () => {
  it('keeps workspace links in workspace settings and organization links in the resolver', () => {
    expect(getAccessRequestsSettingsHref({ kind: 'workspace', workspaceId: 'workspace/a' })).toBe(
      '/workspace/workspace%2Fa/settings/requests'
    )
    expect(getAccessRequestsSettingsHref({ kind: 'organization', organizationId: 'org-a' })).toBe(
      '/o/org-a/settings/requests'
    )
    expect(
      getMyAccessRequestHref({ kind: 'workspace', workspaceId: 'workspace/a' }, 'request/a')
    ).toBe('/workspace/workspace%2Fa/settings/requests?view=requests&requestId=request%2Fa')
    expect(
      getMyAccessRequestHref({ kind: 'organization', organizationId: 'org/a' }, 'request/a')
    ).toBe('/access-requests?view=requests&requestId=request%2Fa&organizationId=org%2Fa')
  })

  it('preserves requester selection, search and pagination with an explicit requester view', () => {
    const query = new URLSearchParams(
      getLegacyAccessRequestsSettingsQuery({
        requestId: 'request/a',
        search: 'Tables and files',
        page: '2',
        organizationId: 'org-a',
      })
    )
    expect(Object.fromEntries(query)).toEqual({
      view: 'requests',
      requestId: 'request/a',
      search: 'Tables and files',
      page: '2',
    })
  })

  it.each(['admin', 'review'])(
    'preserves %s review links with canonical selection and filters',
    (view) => {
      const query = new URLSearchParams(
        getLegacyAccessRequestsSettingsQuery({
          view,
          requestId: 'request/a',
          'request-search': 'Tables',
          'request-page': '2',
          'request-status': 'declined',
        })
      )
      expect(Object.fromEntries(query)).toEqual({
        view: 'review',
        'request-id': 'request/a',
        'request-search': 'Tables',
        'request-page': '2',
        'request-status': 'declined',
      })
    }
  )

  it('prefers canonical review selection when both selection parameters are present', () => {
    const query = new URLSearchParams(
      getLegacyAccessRequestsSettingsQuery({
        view: 'review',
        requestId: 'old',
        'request-id': 'current',
      })
    )
    expect(query.get('request-id')).toBe('current')
    expect(query.has('requestId')).toBe(false)
  })

  it('preserves Browse access and parses invalid state through shared parsers', () => {
    expect(getLegacyAccessRequestsSettingsQuery({ view: 'catalog', search: 'Tables' })).toBe(
      '?view=catalog&search=Tables'
    )
    expect(
      getLegacyAccessRequestsSettingsQuery({ view: 'invalid', page: '-1', search: 'a'.repeat(201) })
    ).toBe('?view=requests')
  })
})

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
