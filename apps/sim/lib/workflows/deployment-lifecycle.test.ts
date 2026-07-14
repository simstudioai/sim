/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canTransitionDeploymentOperation,
  createDeploymentReadiness,
  isDeploymentReadinessComplete,
  parseDeploymentReadiness,
  toSafeDeploymentError,
} from '@/lib/workflows/deployment-lifecycle'

describe('deployment lifecycle', () => {
  it('allows only forward in-flight transitions', () => {
    expect(canTransitionDeploymentOperation('preparing', 'activating')).toBe(true)
    expect(canTransitionDeploymentOperation('preparing', 'failed')).toBe(true)
    expect(canTransitionDeploymentOperation('activating', 'active')).toBe(true)
    expect(canTransitionDeploymentOperation('active', 'activating')).toBe(false)
    expect(canTransitionDeploymentOperation('failed', 'preparing')).toBe(false)
  })

  it('tracks required component readiness without accepting malformed state', () => {
    const readiness = createDeploymentReadiness(
      ['webhooks', 'schedules'],
      new Date('2026-07-14T08:00:00.000Z')
    )
    expect(isDeploymentReadinessComplete(readiness)).toBe(false)

    readiness.webhooks.status = 'ready'
    readiness.schedules.status = 'ready'
    expect(isDeploymentReadinessComplete(readiness)).toBe(true)
    expect(parseDeploymentReadiness(readiness)).toEqual(readiness)
    expect(
      parseDeploymentReadiness({ schedules: { status: 'unknown', updatedAt: 'now' } })
    ).toBeNull()
  })

  it('sanitizes persisted errors', () => {
    const error = Object.assign(
      new Error(
        'authorization=Bearer-secret password=hunter2 https://user:pass@example.com failed\nnext'
      ),
      { code: 'UPSTREAM SECRET/FAILURE' }
    )

    expect(toSafeDeploymentError(error)).toEqual({
      code: 'upstream_secret_failure',
      message:
        'authorization=[redacted] password=[redacted] https://[redacted]@example.com failed next',
    })
  })

  it('drops driver bound-parameter tails that can carry credentials', () => {
    const error = new Error(
      'Failed query: insert into "webhook" ("id", "provider_config") values ($1, $2)\nparams: wh-1,{"triggerApiKey":"super-secret-key"}'
    )

    expect(toSafeDeploymentError(error).message).toBe(
      'Failed query: insert into "webhook" ("id", "provider_config") values ($1, $2)'
    )
  })
})
