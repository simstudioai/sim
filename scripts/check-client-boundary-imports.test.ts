import { describe, expect, it } from 'vitest'
import {
  isDeploymentShapeSurface,
  ratchetDeploymentShape,
  shapeEnvVariables,
} from './check-client-boundary-imports'

describe('isDeploymentShapeSurface', () => {
  it.each([
    'app/(auth)/login/login-form.tsx',
    'app/_shell/providers/query-provider.tsx',
    'app/_organization-conversation/view.tsx',
    'app/(interfaces)/chat/page.tsx',
    'app/(product)/page.tsx',
    'platform/shared/rows.ts',
  ])('covers %s', (file) => {
    expect(isDeploymentShapeSurface(file)).toBe(true)
  })

  it.each(['app/api/auth/route.ts', 'lib/core/config/env-flags.ts', 'components/icons.tsx'])(
    'leaves %s to the other rules',
    (file) => {
      expect(isDeploymentShapeSurface(file)).toBe(false)
    }
  )
})

describe('ratchetDeploymentShape', () => {
  it('fails a read the baseline does not hold, and a baseline entry no longer read', () => {
    expect(
      ratchetDeploymentShape(
        ['a.tsx:isHosted', 'b.tsx:isSsoEnabled'],
        new Set(['b.tsx:isSsoEnabled', 'c.tsx:isHosted'])
      )
    ).toEqual({ fresh: ['a.tsx:isHosted'], stale: ['c.tsx:isHosted'] })
  })
})

describe('shapeEnvVariables', () => {
  it('reads the variables behind shape flags, across lines, and none behind other flags', () => {
    const source = [
      "export const isInviteHidden = isTruthy(getEnv('NEXT_PUBLIC_DISABLE_INVITATIONS'))",
      '',
      'export const isSsoEnabled =',
      "  isTruthy(env.SSO_ENABLED) || isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))",
      '',
      "export const isPublicApiDisabled = isTruthy(getEnv('NEXT_PUBLIC_DISABLE_PUBLIC_API'))",
    ].join('\n')
    expect(shapeEnvVariables(source, new Set(['isInviteHidden', 'isSsoEnabled']))).toEqual([
      'NEXT_PUBLIC_DISABLE_INVITATIONS',
      'NEXT_PUBLIC_SSO_ENABLED',
    ])
  })
})
