/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isOktaFlagEnabled,
  mapOktaGroupRule,
  oktaHeaders,
  parseOktaPagination,
  throwOktaError,
} from '@/tools/okta/utils'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_TOKEN = 'not-a-real-api-token'

const BASE = 'https://example.okta.com/api/v1/users'

function responseWithLink(link?: string): Response {
  return new Response('[]', {
    status: 200,
    headers: link ? { Link: link } : {},
  })
}

describe('oktaHeaders', () => {
  it('authenticates with the SSWS scheme rather than Bearer', () => {
    expect(oktaHeaders(PLACEHOLDER_TOKEN).Authorization).toBe(`SSWS ${PLACEHOLDER_TOKEN}`)
  })
})

describe('parseOktaPagination', () => {
  it('extracts the after cursor from a rel="next" link', () => {
    const link = `<${BASE}?after=cursor123&limit=200>; rel="next"`
    expect(parseOktaPagination(responseWithLink(link))).toEqual({
      nextCursor: 'cursor123',
      hasMore: true,
    })
  })

  it('reports the last page when only a self link is present', () => {
    const link = `<${BASE}?limit=200>; rel="self"`
    expect(parseOktaPagination(responseWithLink(link))).toEqual({
      nextCursor: null,
      hasMore: false,
    })
  })

  it('picks the next link when self is advertised alongside it', () => {
    const link = `<${BASE}?limit=200>; rel="self", <${BASE}?after=page2>; rel="next"`
    expect(parseOktaPagination(responseWithLink(link))).toEqual({
      nextCursor: 'page2',
      hasMore: true,
    })
  })

  it('reports the last page when no Link header is sent at all', () => {
    expect(parseOktaPagination(responseWithLink())).toEqual({ nextCursor: null, hasMore: false })
  })

  it('reports more results without a cursor when the next link is malformed', () => {
    expect(parseOktaPagination(responseWithLink('<not a url>; rel="next"'))).toEqual({
      nextCursor: null,
      hasMore: true,
    })
  })
})

describe('mapOktaGroupRule', () => {
  it('lifts the expression, target groups, and exclusions to the top level', () => {
    const mapped = mapOktaGroupRule({
      id: '0pr1',
      name: 'Engineers',
      type: 'group_rule',
      status: 'ACTIVE',
      created: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-02T00:00:00.000Z',
      conditions: {
        expression: { value: 'user.department == "Eng"', type: 'urn:okta:expression:1.0' },
        people: { users: { exclude: ['00u1'] }, groups: { exclude: ['00g1'] } },
      },
      actions: { assignUserToGroups: { groupIds: ['00g2'] } },
    })

    expect(mapped).toMatchObject({
      id: '0pr1',
      expression: 'user.department == "Eng"',
      expressionType: 'urn:okta:expression:1.0',
      assignUserToGroupIds: ['00g2'],
      excludedUserIds: ['00u1'],
      excludedGroupIds: ['00g1'],
    })
  })

  it('defaults absent nested conditions instead of throwing', () => {
    expect(
      mapOktaGroupRule({ id: '0pr2', name: 'Bare', type: 'group_rule', status: 'INACTIVE' })
    ).toMatchObject({
      created: null,
      lastUpdated: null,
      expression: null,
      expressionType: null,
      assignUserToGroupIds: [],
      excludedUserIds: [],
      excludedGroupIds: [],
    })
  })
})

describe('throwOktaError', () => {
  const logger = { error: vi.fn() } as unknown as Parameters<typeof throwOktaError>[1]

  function errorResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 400 })
  }

  /**
   * `E0000001` is Okta's most common write failure and its `errorSummary` is the
   * useless "Api validation failed: profile" — the failing field and the reason
   * live only in `errorCauses`.
   */
  it('appends the causes that carry the actual reason', async () => {
    await expect(
      throwOktaError(
        errorResponse({
          errorCode: 'E0000001',
          errorSummary: 'Api validation failed: profile',
          errorCauses: [
            {
              errorSummary:
                'login: An object with this field already exists in the current organization',
            },
          ],
        }),
        logger,
        'Failed to create user in Okta'
      )
    ).rejects.toThrowError(
      new Error(
        'Api validation failed: profile: login: An object with this field already exists in the current organization'
      )
    )
  })

  it('joins several causes so no failing field is hidden', async () => {
    await expect(
      throwOktaError(
        errorResponse({
          errorSummary: 'Api validation failed: profile',
          errorCauses: [{ errorSummary: 'login: is required' }, { errorSummary: 'email: invalid' }],
        }),
        logger,
        'fallback'
      )
    ).rejects.toThrowError(
      new Error('Api validation failed: profile: login: is required: email: invalid')
    )
  })

  it('falls back to the causes alone when there is no summary', async () => {
    await expect(
      throwOktaError(
        errorResponse({ errorCauses: [{ errorSummary: 'login: is required' }] }),
        logger,
        'fallback'
      )
    ).rejects.toThrowError(new Error('login: is required'))
  })

  it('drops blank causes rather than emitting a trailing separator', async () => {
    await expect(
      throwOktaError(
        errorResponse({
          errorSummary: 'Api validation failed: profile',
          errorCauses: [{ errorSummary: '  ' }],
        }),
        logger,
        'fallback'
      )
    ).rejects.toThrowError(new Error('Api validation failed: profile'))
  })

  it("falls back to the caller's message on an empty lifecycle body", async () => {
    await expect(
      throwOktaError(new Response('', { status: 404 }), logger, 'Failed to activate user in Okta')
    ).rejects.toThrowError(new Error('Failed to activate user in Okta'))
  })
})

describe('isOktaFlagEnabled', () => {
  it.each([true, 'true', 'TRUE', ' yes ', 'y', '1', 'on', 1])('reads %o as enabled', (value) => {
    expect(isOktaFlagEnabled(value)).toBe(true)
  })

  it.each([false, 'false', 'no', '0', 'off', 0, '', 'maybe', null, undefined, {}])(
    'reads %o as disabled',
    (value) => {
      expect(isOktaFlagEnabled(value)).toBe(false)
    }
  )
})
