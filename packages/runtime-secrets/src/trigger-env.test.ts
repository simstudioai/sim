import { describe, expect, it } from 'vitest'
import { buildTriggerEnvVars, parseTriggerEnvSyncTargets } from './trigger-env'

describe('buildTriggerEnvVars', () => {
  it('leaves the worker-specific network endpoints to the Trigger.dev environment', () => {
    const synced = buildTriggerEnvVars({
      REDIS_URL: 'rediss://vpc-redis:6379',
      INTERNAL_API_BASE_URL: 'http://app.internal',
      OUTBOUND_GATEWAYS: '{"gw":{"url":"https://vpc-lb:8443"}}',
      OUTBOUND_GATEWAY_CREDENTIALS: '{"gw":{"token":"t"}}',
      OUTBOUND_ROUTING_SOURCE: 'appconfig',
    }).map((v) => v.name)
    expect(synced).not.toContain('REDIS_URL')
    expect(synced).not.toContain('INTERNAL_API_BASE_URL')
    expect(synced).not.toContain('OUTBOUND_GATEWAYS')
    expect(synced).toContain('OUTBOUND_GATEWAY_CREDENTIALS')
    expect(synced).toContain('OUTBOUND_ROUTING_SOURCE')
  })
})

describe('parseTriggerEnvSyncTargets', () => {
  it('reads an exact comma list', () => {
    expect([...parseTriggerEnvSyncTargets('preview,staging,prod')].sort()).toEqual([
      'preview',
      'prod',
      'staging',
    ])
  })

  it('treats an unset or empty gate as no targets', () => {
    expect(parseTriggerEnvSyncTargets(undefined).size).toBe(0)
    expect(parseTriggerEnvSyncTargets('').size).toBe(0)
  })

  it.each([
    'preview, staging',
    'preview,,staging',
    'preview,',
    ' ',
    'preview,Staging',
    'preview,production',
    'constructor',
    'preview,toString',
  ])('refuses %j, which the deploy workflows would not grant credentials for', (value) => {
    expect(() => parseTriggerEnvSyncTargets(value)).toThrow(/TRIGGER_ENV_SYNC_TARGETS/)
  })
})
