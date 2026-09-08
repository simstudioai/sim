/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import { describe, expect, it } from 'vitest'
import { assertOperationPrincipal, defineOperation } from '@/lib/core/application/operation'

const readSelf = defineOperation({
  id: 'meta.capabilities.read',
  capability: 'none',
  principalKinds: ['personal_api_key', 'workspace_api_key'],
})

describe('defineOperation', () => {
  it('freezes the operation and its principal list so nothing widens it at runtime', () => {
    expect(Object.isFrozen(readSelf)).toBe(true)
    expect(Object.isFrozen(readSelf.principalKinds)).toBe(true)
  })

  it('rejects an operation that names no principal', () => {
    expect(() =>
      defineOperation({ id: 'meta.empty', capability: 'none', principalKinds: [] })
    ).toThrow('Operation meta.empty must allow at least one principal kind')
  })

  it('rejects a duplicated principal kind', () => {
    expect(() =>
      defineOperation({
        id: 'meta.duplicate',
        capability: 'none',
        principalKinds: ['session', 'session'],
      })
    ).toThrow('Operation meta.duplicate declares duplicate principal kinds')
  })
})

describe('assertOperationPrincipal', () => {
  it('accepts a principal kind the operation names', () => {
    const principal: Principal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }

    expect(() => assertOperationPrincipal(principal, readSelf)).not.toThrow()
  })

  /**
   * A plain `Error`, not a `forbidden` one: a principal-scoped operation is
   * reachable from a single authenticating surface, so a kind it does not name
   * is a wiring bug rather than a refusal a caller can provoke — and rendering
   * it as a 403 would publish a wire status no request can reach.
   */
  it('raises an invariant failure, not a forbidden, for a kind it does not name', () => {
    const principal: Principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }

    let thrown: unknown
    try {
      assertOperationPrincipal(principal, readSelf)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(
      'Operation meta.capabilities.read reached by principal kind session, which its policy does not name'
    )
    expect(thrown).not.toHaveProperty('code')
  })
})

/**
 * The guard the type cannot give, because `apps/sim/tsconfig.json` excludes test
 * files: a fixture is the one construction site no static check reads.
 */
describe('assertOperationCapability', () => {
  it('refuses an operation that declares no capability', () => {
    expect(() =>
      // @ts-expect-error a fixture is the one place an absent capability can be written
      defineOperation({ id: 'meta.uncapped', principalKinds: ['session'] })
    ).toThrow("Operation meta.uncapped declares no capability; name one, or 'none' with a reason")
  })

  it('refuses a capability the registry does not declare', () => {
    expect(() =>
      defineOperation({
        id: 'meta.unknown',
        // @ts-expect-error the point of the test is a capability outside the registry
        capability: 'meta.invented',
        principalKinds: ['session'],
      })
    ).toThrow('Operation meta.unknown names unknown capability meta.invented')
  })

  it('refuses a parameterized capability the funnel cannot apply', () => {
    expect(() =>
      defineOperation({
        id: 'meta.parameterized',
        // @ts-expect-error a parameterized capability is not a StaticPermissionGroupCapability
        capability: 'deploy.chat.auth_mode',
        principalKinds: ['session'],
      })
    ).toThrow(
      'Operation meta.parameterized declares parameterized capability deploy.chat.auth_mode; assert it from the use case instead'
    )
  })

  it.each(['personal_api_key.use', 'oauth_apps.use'] as const)(
    'refuses principal-wide capability %s as an operation capability',
    (capability) => {
      expect(() =>
        defineOperation({
          id: 'meta.principal_wide',
          // @ts-expect-error principal-wide capabilities are not OperationDeclarableCapability
          capability,
          principalKinds: ['session'],
        })
      ).toThrow(`Operation meta.principal_wide declares principal-wide capability ${capability}`)
    }
  )
})
