import { describe, expect, it } from 'vitest'
import { AshbyBlock } from './ashby'

describe('AshbyBlock', () => {
  const buildParams = (operation: string, extra: Record<string, unknown>) => ({
    operation,
    ...extra,
  })

  describe('alternateEmailAddresses parsing (create_candidate)', () => {
    it('parses a comma-separated string into an array', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', {
          alternateEmailAddresses: 'a@x.com, b@x.com',
        })
      )
      expect(result.alternateEmailAddresses).toEqual(['a@x.com', 'b@x.com'])
    })
  })

  describe('socialLinks parsing (update_candidate)', () => {
    it('preserves an empty JSON array so users can clear all social links', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('update_candidate', { socialLinks: '[]' })
      )
      expect(result.socialLinks).toEqual([])
    })

    it('throws instead of silently dropping the field when the JSON is malformed', () => {
      // A silent [] here would let the Ashby update proceed without applying
      // the requested links and with no error shown to the workflow author.
      expect(() =>
        AshbyBlock.tools.config.params!(
          buildParams('update_candidate', { socialLinks: 'not json' })
        )
      ).toThrow(/Invalid JSON in Ashby social links/)
    })

    it('throws when the parsed JSON is not an array', () => {
      expect(() =>
        AshbyBlock.tools.config.params!(
          buildParams('update_candidate', { socialLinks: '{"type":"Twitter"}' })
        )
      ).toThrow(/expected a JSON array/)
    })
  })

  describe('nullable candidate updates', () => {
    it('preserves nulls from dynamic references for aliased update fields', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('update_candidate', {
          updateName: null,
          candidateLocation: null,
          candidateCreatedAt: null,
        })
      )
      expect(result.name).toBeNull()
      expect(result.location).toBeNull()
      expect(result.createdAt).toBeNull()
    })
  })

  describe('archiveEmail parsing (change_application_stage)', () => {
    it('rejects non-object archive email input', () => {
      expect(() =>
        AshbyBlock.tools.config.params!(
          buildParams('change_application_stage', { archiveEmail: 'true' })
        )
      ).toThrow(/expected a JSON object/)
    })
  })

  describe('fieldValue parsing (set_custom_field_value)', () => {
    const parse = (fieldValue: unknown) =>
      AshbyBlock.tools.config.params!(buildParams('set_custom_field_value', { fieldValue }))
        .fieldValue

    it('decodes null so the annotation can be cleared', () => {
      // Ashby clears a custom field when it receives an explicit null, which is
      // what makes a written annotation reversible.
      expect(parse('null')).toBeNull()
    })

    it('passes unparseable text through as a plain string', () => {
      // A bare option name is the most common input for String, LongText, and
      // ValueSelect fields, so it must not be rejected as invalid JSON.
      expect(parse('Senior Engineer')).toBe('Senior Engineer')
    })

    it('does not let an overflowing number become a field clear', () => {
      // 1e999 parses to Infinity, which JSON.stringify emits as null - and null
      // clears the field. The user typed a number, not a clear.
      expect(parse('1e999')).toBe('1e999')
    })

    it('does not silently lose precision on long numeric ids', () => {
      expect(parse('12345678901234567890')).toBe('12345678901234567890')
      expect(parse('0123')).toBe('0123')
    })

    it('leaves prose that merely starts like JSON alone when it does not parse', () => {
      expect(parse('{not really json')).toBe('{not really json')
    })
  })

  describe('fieldValues parsing (set_custom_field_values)', () => {
    it('throws instead of silently dropping the writes when the JSON is malformed', () => {
      expect(() =>
        AshbyBlock.tools.config.params!(
          buildParams('set_custom_field_values', { fieldValues: 'not json' })
        )
      ).toThrow(/Invalid JSON in Ashby custom field values/)
    })

    it('throws when the parsed JSON is not an array', () => {
      expect(() =>
        AshbyBlock.tools.config.params!(
          buildParams('set_custom_field_values', { fieldValues: '{"fieldId":"abc"}' })
        )
      ).toThrow(/expected a JSON array/)
    })
  })

  describe('change_application_source', () => {
    it('never sends a stale source id alongside a clear request', () => {
      // The Source ID field is hidden once the clear switch is on, but a value
      // typed beforehand is still stored. Sending both would trip the tool's
      // exclusivity guard and surface as an error the user cannot see the cause of.
      const result = AshbyBlock.tools.config.params!(
        buildParams('change_application_source', {
          changeSourceId: 'src-left-over',
          unsetSource: 'true',
        })
      )
      expect(result.unsetSource).toBe(true)
      expect(result).toHaveProperty('sourceId')
      expect(result.sourceId).toBeUndefined()
    })

    it('never inherits a stale create-path source id through the executor merge', () => {
      // The executor runs `{ ...inputs, ...transformedParams }`, so any key this
      // mapping leaves unset inherits whatever inputs held. The shared
      // create-path `sourceId` subblock reaches inputs even on this operation:
      // it is mode 'advanced', and the serializer includes an advanced subblock
      // on a non-empty value without evaluating its condition. Assert the merged
      // result, not just the mapping, since that gap is where the bug lived.
      const merge = (inputs: Record<string, unknown>) => ({
        ...inputs,
        ...AshbyBlock.tools.config.params!(inputs),
      })

      const cleared = merge(
        buildParams('change_application_source', {
          applicationId: 'app-1',
          sourceId: 'stale-from-create-application',
          changeSourceId: '',
          unsetSource: 'true',
        })
      )
      expect(cleared.sourceId).toBeUndefined()
      expect(cleared.unsetSource).toBe(true)

      const untouched = merge(
        buildParams('change_application_source', {
          applicationId: 'app-1',
          sourceId: 'stale-from-create-application',
          changeSourceId: '',
        })
      )
      expect(untouched.sourceId).toBeUndefined()

      const explicit = merge(
        buildParams('change_application_source', {
          applicationId: 'app-1',
          sourceId: 'stale-from-create-application',
          changeSourceId: 'src-intended',
        })
      )
      expect(explicit.sourceId).toBe('src-intended')
    })
  })
})
