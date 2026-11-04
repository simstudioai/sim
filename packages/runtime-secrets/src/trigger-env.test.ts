import { describe, expect, it } from 'vitest'
import { parseTriggerEnvSyncTargets } from './trigger-env'

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
