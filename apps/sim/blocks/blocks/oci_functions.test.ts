/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { OciFunctionsBlock } from '@/blocks/blocks/oci_functions'

function map(input: Record<string, unknown>) {
  return { ...input, ...OciFunctionsBlock.tools.config?.params?.(input) }
}

/** Raw block values are merged underneath the mapper patch by the executor. */
describe('OCI Functions execution-time parameter mapping', () => {
  it('clears stale invocation fields when changing operations', () => {
    const result = map({
      operation: 'get_function',
      oauthCredential: 'credential-1',
      functionId: 'function-1',
      payload: '{broken',
      file: { key: 'old-file' },
      dryRun: true,
      invocationType: 'detached',
      configuration: '{broken',
      applicationId: 'stale-app',
    })
    expect(result.functionId).toBe('function-1')
    for (const key of [
      'payload',
      'file',
      'dryRun',
      'invocationType',
      'configuration',
      'applicationId',
    ]) {
      expect(result[key]).toBeUndefined()
    }
  })

  it('preserves a manual canonical function OCID without discovery-only scope', () => {
    const result = map({
      operation: 'invoke',
      oauthCredential: 'credential-1',
      functionId: 'known-function',
      ociRegion: 'credential',
    })
    expect(result.functionId).toBe('known-function')
    expect(result.applicationId).toBeUndefined()
    expect(result.compartmentId).toBeUndefined()
    expect(result.region).toBeUndefined()
  })

  it('maps the selector region into the service request region', () => {
    expect(map({ operation: 'get_function', ociRegion: 'us-phoenix-1' }).region).toBe(
      'us-phoenix-1'
    )
  })

  it('coerces resolved numeric, boolean, and JSON values only at execution time', () => {
    const result = map({
      operation: 'invoke',
      payloadType: 'json',
      payload: 'false',
      dryRun: 'false',
      timeoutMs: '120000',
    })
    expect(result).toMatchObject({ payload: false, dryRun: false, timeoutMs: 120000 })
    expect(
      map({ operation: 'create_function', memoryInMBs: '512', configuration: '{"config":{}}' })
    ).toMatchObject({ memoryInMBs: 512, configuration: { config: {} } })
    expect(map({ operation: 'create_application', subnetIds: '["subnet-1"]' }).subnetIds).toEqual([
      'subnet-1',
    ])
  })

  it.each(['false', '0', 'null', '""'])('preserves JSON value %s', (payload) => {
    expect(map({ operation: 'invoke', payloadType: 'json', payload }).payload).toEqual(
      JSON.parse(payload)
    )
  })

  it('keeps text unencoded and clears file data in text mode', () => {
    const result = map({
      operation: 'invoke',
      payloadType: 'text',
      payload: 'plain text',
      file: { key: 'stale' },
    })
    expect(result.payload).toBe('plain text')
    expect(result.file).toBeUndefined()
  })

  it('normalizes a single file and rejects multiple files', () => {
    const file = { key: 'file-1', name: 'input.bin', size: 2 }
    const result = map({ operation: 'invoke', payloadType: 'file', file: [file], payload: 'stale' })
    expect(result.file).toEqual(file)
    expect(result.payload).toBeUndefined()
    expect(() => map({ operation: 'invoke', payloadType: 'file', file: [file, file] })).toThrow()
  })

  it('rejects malformed JSON and numbers before provider execution', () => {
    expect(() => map({ operation: 'invoke', payloadType: 'json', payload: '{' })).toThrow(
      'Payload must be valid JSON'
    )
    expect(() => map({ operation: 'list_applications', limit: '51' })).toThrow()
    expect(() => map({ operation: 'invoke', dryRun: 'maybe' })).toThrow(
      'Dry run must be true or false'
    )
    expect(() => map({ operation: 'unknown' })).toThrow('Invalid OCI Functions operation')
  })
})
