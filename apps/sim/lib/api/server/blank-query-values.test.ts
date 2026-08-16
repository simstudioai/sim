/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import {
  blankQueryValueValidationError,
  duplicateQueryValueValidationError,
} from '@/lib/api/server/blank-query-values'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { v2ValidationError } from '@/app/api/v2/lib/response'

/**
 * A query parameter that is present but blank is a different request from one
 * that was omitted, and no schema can tell the difference on its own: coercion
 * has already turned `''` into `0`, `false`, or a default before validation
 * runs. `?limit=` on the lists that clamp reached SQL as `LIMIT 1`, and
 * `?minCost=` on `/logs` became a live `cost >= 0` filter — both silently wrong
 * pages rather than errors.
 */
describe('blank query values', () => {
  it('rejects an empty value and names the parameter', () => {
    const error = blankQueryValueValidationError({ workspaceId: 'workspace-1', limit: '' })

    expect(error?.issues[0]).toMatchObject({
      path: ['limit'],
      message: 'limit cannot be empty; omit the parameter instead',
    })
  })

  it('treats a whitespace-only value the same way', () => {
    expect(blankQueryValueValidationError({ limit: ' ' })?.issues[0]?.path).toEqual(['limit'])
    expect(blankQueryValueValidationError({ limit: '\t' })?.issues[0]?.path).toEqual(['limit'])
  })

  it('rejects a repeated parameter where any occurrence is blank', () => {
    expect(blankQueryValueValidationError({ folderPaths: ['/live', ''] })?.issues[0]?.path).toEqual(
      ['folderPaths']
    )
  })

  it('accepts a query with no blank values, including a literal zero', () => {
    expect(
      blankQueryValueValidationError({ limit: '0', search: 'a', folderPaths: ['/a', '/b'] })
    ).toBeNull()
    expect(blankQueryValueValidationError({})).toBeNull()
  })

  /**
   * The rule is a v2-surface default rather than something each route opts into,
   * for the same reason the malformed-body envelope is: an opt-in is applied by
   * whoever remembered it, and the params this protects are exactly the ones
   * nobody thought about.
   */
  it('is on for every v2 route through the shared parse defaults', () => {
    expect(V2_PARSE_DEFAULTS.rejectBlankQueryValues).toBe(true)
  })
})

const listContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/widgets',
  query: z.object({ workspaceId: z.string().min(1, 'Workspace ID is required') }),
  response: { mode: 'json', schema: z.object({ data: z.array(z.string()) }) },
})

function listRequest(search: string): NextRequest {
  return new NextRequest(`http://localhost/api/v2/widgets?${search}`, { method: 'GET' })
}

async function parseListRequest(search: string) {
  return parseRequest(
    listContract,
    listRequest(search),
    {},
    {
      ...V2_PARSE_DEFAULTS,
      validationErrorResponse: v2ValidationError,
    }
  )
}

/**
 * A repeated parameter reaches the schema as an array, and no v2 query param is
 * declared as one — so without this rule the caller is told the param is
 * *missing* for a request that plainly sent it twice.
 */
describe('duplicate query values', () => {
  it('names the duplication rather than the schema type failure', () => {
    const error = duplicateQueryValueValidationError({ workspaceId: ['w-1', 'w-1'] })

    expect(error?.issues[0]).toMatchObject({
      path: ['workspaceId'],
      message: 'workspaceId was sent 2 times; send it at most once',
    })
  })

  it('accepts a query where every parameter appears once', () => {
    expect(duplicateQueryValueValidationError({ workspaceId: 'w-1', limit: '10' })).toBeNull()
  })

  it('rejects a repeated parameter through parseRequest under the v2 defaults', async () => {
    const parsed = await parseListRequest('workspaceId=w-1&workspaceId=w-1')

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.response.status).toBe(400)
    await expect(parsed.response.json()).resolves.toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining('workspaceId was sent 2 times; send it at most once'),
      }),
    })
  })

  it('lets a query sending each parameter once through parseRequest', async () => {
    const parsed = await parseListRequest('workspaceId=w-1')

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.query).toEqual({ workspaceId: 'w-1' })
  })

  it('is on for every v2 route through the shared parse defaults', () => {
    expect(V2_PARSE_DEFAULTS.rejectDuplicateQueryValues).toBe(true)
  })
})
