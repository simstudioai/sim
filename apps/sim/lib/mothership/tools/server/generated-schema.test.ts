/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { validateGeneratedToolPayload } from '@/lib/mothership/tools/server/generated-schema'

describe('validateGeneratedToolPayload', () => {
  it('accepts prepare_file_edit create with a new_file target', () => {
    // The handler has always supported create + new_file, but the generated schema
    // forbade it, so a "save this report as a file" turn died on input validation
    // (dev, 2026-09-03) with no way to create a file through the watched write.
    const payload = {
      operation: 'create',
      title: 'Report',
      target: { kind: 'new_file', fileName: 'report.md' },
    }
    expect(validateGeneratedToolPayload('prepare_file_edit', 'parameters', payload)).toBe(payload)
  })

  it('still rejects an operation the surface does not have', () => {
    expect(() =>
      validateGeneratedToolPayload('prepare_file_edit', 'parameters', {
        operation: 'overwrite',
        title: 'Report',
        target: { kind: 'path', path: 'files/report.md' },
      })
    ).toThrow(/operation must be equal to one of the allowed values/)
  })
})
