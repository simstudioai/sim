import { describe, expect, it } from 'vitest'
import { parseTriggerEnvSyncTargets } from './trigger-env'

describe('parseTriggerEnvSyncTargets', () => {
  it('reads a comma list with stray whitespace and empty entries', () => {
    expect([...parseTriggerEnvSyncTargets(' preview, staging ,,prod ')].sort()).toEqual([
      'preview',
      'prod',
      'staging',
    ])
  })

  it('treats an unset or blank gate as no targets', () => {
    expect(parseTriggerEnvSyncTargets(undefined).size).toBe(0)
    expect(parseTriggerEnvSyncTargets('  ').size).toBe(0)
  })

  it.each(['Staging', 'production', 'constructor', 'toString'])(
    'refuses %s, which no app env-vars secret is mapped to',
    (target) => {
      expect(() => parseTriggerEnvSyncTargets(`preview,${target}`)).toThrow(target)
    }
  )
})
