/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as oktaTools from '@/tools/okta'
import type { ToolConfig } from '@/tools/types'

/**
 * Okta's Management API spec (`okta/okta-management-openapi-spec`,
 * `dist/2026.08.1/management-oneOfInheritance-noExamples.yaml`) distinguishes
 * two user path parameters:
 *
 * - `pathId` — "An ID, login, or login shortname (as long as the shortname is
 *   unambiguous) of an existing Okta user". Used by `/api/v1/users/{id}` and
 *   every `/api/v1/users/{id}/lifecycle/*` operation.
 * - `pathUserId` / `pathAppUserId` — "ID of an existing Okta user". Used by
 *   `/api/v1/users/{userId}/factors`, `/roles`, `/sessions`, and by the
 *   group- and app-membership paths.
 *
 * The `userId` param on every Okta tool is `user-or-llm`, so its description is
 * the only thing a model reads before choosing what to pass. Advertising a
 * login on a `pathUserId` endpoint produces a 404; withholding it on a `pathId`
 * endpoint makes the model resolve an ID it never needed.
 */
const USER_SENTINEL = 'SIM-USER-SENTINEL'

/** The `{id}` positions Okta documents as ID-, login-, or shortname-addressable. */
const LOGIN_CAPABLE_PATH = new RegExp(`^/api/v1/users/${USER_SENTINEL}(?:/lifecycle/[^/]+)?/?$`)

const AUTH_PARAMS: Record<string, unknown> = {
  apiKey: 'token',
  domain: 'dev-123456.okta.com',
}

interface OktaUserTool {
  id: string
  description: string
  pathname: string
}

/** Fills every declared param so a declarative `url` builder can run. */
function sentinelParams(tool: ToolConfig): Record<string, unknown> {
  const params: Record<string, unknown> = { ...AUTH_PARAMS }
  for (const [name, schema] of Object.entries(tool.params ?? {})) {
    if (name in params) continue
    if (name === 'userId') {
      params[name] = USER_SENTINEL
      continue
    }
    params[name] = schema.type === 'number' ? 1 : schema.type === 'boolean' ? false : `sim-${name}`
  }
  return params
}

/**
 * Calls a declarative `url` builder with the untyped shape a tool really
 * receives — the typed params interface is erased at the call boundary.
 */
function builtUrl(tool: ToolConfig): string {
  const build = tool.request?.url
  if (typeof build !== 'function') throw new Error(`${tool.id} has no url builder`)
  return build(sentinelParams(tool) as never)
}

const oktaUserTools: OktaUserTool[] = Object.values(oktaTools)
  .filter((tool): tool is ToolConfig => Boolean(tool?.id?.startsWith('okta_')))
  .filter((tool) => Boolean(tool.params?.userId))
  .map((tool) => ({
    id: tool.id,
    description: tool.params.userId.description ?? '',
    pathname: new URL(builtUrl(tool)).pathname,
  }))

/**
 * A description advertises a login when it offers a login or an email as an
 * accepted value. A negated clause ("not a login or email") withholds one, so
 * it is stripped before the check — otherwise the warning an ID-only tool
 * carries would read as the promise it exists to deny.
 */
function advertisesLogin(description: string): boolean {
  const affirmative = description.replace(/\bnot an? [^.)]*/gi, '')
  return /\blogins?\b|\bemail\b/i.test(affirmative)
}

describe('okta user path param descriptions', () => {
  it('finds Okta tools carrying a userId param', () => {
    expect(oktaUserTools.length).toBeGreaterThan(15)
  })

  it('covers both Okta path-parameter kinds', () => {
    const loginCapable = oktaUserTools.filter((tool) => LOGIN_CAPABLE_PATH.test(tool.pathname))
    expect(loginCapable.length).toBeGreaterThan(0)
    expect(oktaUserTools.length - loginCapable.length).toBeGreaterThan(0)
  })

  it.each(oktaUserTools.map((tool) => [tool.id, tool] as const))(
    '%s describes userId the way its endpoint accepts it',
    (_id, tool) => {
      const loginCapable = LOGIN_CAPABLE_PATH.test(tool.pathname)
      expect({
        pathname: tool.pathname,
        advertisesLogin: advertisesLogin(tool.description),
      }).toEqual({ pathname: tool.pathname, advertisesLogin: loginCapable })
    }
  )
})
