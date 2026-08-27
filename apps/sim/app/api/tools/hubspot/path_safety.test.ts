/**
 * @vitest-environment node
 *
 * The HubSpot `properties` and `pipelines` selector routes assemble their
 * provider URL *here*, from a query parameter, so the reflective `request.url`
 * probe in `tools/hubspot/path_safety.test.ts` cannot see them.
 *
 * `objectType` is genuinely caller-supplied — the contract constrains it only
 * to a non-empty string, and the selector resolves it from the free-text
 * `customObjectTypeId` trigger field. `BUILT_IN_PATH` maps the four known
 * slugs to a safe constant, but the `?? objectType` fallback puts the raw value
 * straight into a path segment. `encodeURIComponent` does not help: `.` and
 * `..` are unreserved, and the WHATWG parser removes a dot segment *after*
 * percent-decoding, so `objectType='..'` re-aims the request one level up with
 * the caller's HubSpot bearer token still attached.
 *
 * Every assertion resolves the outgoing URL through `new URL(...)`, the same
 * normalization `fetch` applies, and compares whole-pathname segment shape
 * rather than the template text.
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorizeCredentialUse, mockRefreshAccessToken } = vi.hoisted(() => ({
  mockAuthorizeCredentialUse: vi.fn(),
  mockRefreshAccessToken: vi.fn(),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessToken,
}))

import { GET as GET_PIPELINES } from '@/app/api/tools/hubspot/pipelines/route'
import { GET as GET_PROPERTIES } from '@/app/api/tools/hubspot/properties/route'

const ORIGIN = 'https://api.hubapi.com'
const CREDENTIAL_ID = 'cred-1'

/**
 * Values that must be rejected outright. `'  ..  '` is included because a
 * padded dot segment is only inert if nothing later trims it.
 */
const REJECTED = ['..', '.', '%2e%2e', 'a/b', '  ..  ', '..%2f..', '../..'] as const

/**
 * The three legal `objectType` spellings from HubSpot's Schemas API —
 * portal-qualified custom object, `{meta-type}-{unique id}`, and a bare custom
 * object name — plus the built-in slug that maps through `BUILT_IN_PATH`.
 */
const LEGITIMATE = ['p7878787_my_object', '2-123456', '0-1', 'my_object'] as const

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthorizeCredentialUse.mockResolvedValue({
    ok: true,
    credentialOwnerUserId: 'user-1',
    resolvedCredentialId: CREDENTIAL_ID,
  })
  mockRefreshAccessToken.mockResolvedValue('inert-token')
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ results: [] }),
    text: async () => '',
  })
  vi.stubGlobal('fetch', fetchMock)
})

function request(path: string, objectType: string) {
  const url = new URL(`http://localhost:3000/api/tools/hubspot/${path}`)
  url.searchParams.set('credentialId', CREDENTIAL_ID)
  url.searchParams.set('objectType', objectType)
  return createMockRequest('GET', undefined, {}, url.toString())
}

function outgoingUrl(): URL {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return new URL(fetchMock.mock.calls[0][0] as string)
}

const ROUTES = [
  { name: 'properties', handler: GET_PROPERTIES, collection: 'properties' },
  { name: 'pipelines', handler: GET_PIPELINES, collection: 'pipelines' },
] as const

describe.each(ROUTES)(
  'GET /api/tools/hubspot/$name path safety',
  ({ name, handler, collection }) => {
    it('maps a built-in slug to its documented plural constant', async () => {
      const response = await handler(request(name, 'contact'))
      expect(response.status).toBe(200)

      const url = outgoingUrl()
      expect(url.origin).toBe(ORIGIN)
      expect(url.pathname.split('/')).toEqual(['', 'crm', 'v3', collection, 'contacts'])
      expect([...url.searchParams.keys()]).toEqual([])
    })

    it.each(LEGITIMATE)('passes %j through byte-identically', async (objectType) => {
      const response = await handler(request(name, objectType))
      expect(response.status).toBe(200)

      const url = outgoingUrl()
      expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/crm/v3/${collection}/${objectType}`)
      expect(url.pathname.split('/')).toEqual(['', 'crm', 'v3', collection, objectType])
    })

    it.each(REJECTED)(
      'rejects objectType=%j with a 400 and never calls HubSpot',
      async (objectType) => {
        const response = await handler(request(name, objectType))

        expect(response.status).toBe(400)
        expect((await response.json()).error).toMatch(/objectType/)
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )
  }
)
