/**
 * @vitest-environment node
 */
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

    it('parses a JSON array string into an array', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', {
          alternateEmailAddresses: '["a@x.com","b@x.com"]',
        })
      )
      expect(result.alternateEmailAddresses).toEqual(['a@x.com', 'b@x.com'])
    })

    it('omits the field entirely when empty', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('create_candidate', { alternateEmailAddresses: '' })
      )
      expect(result.alternateEmailAddresses).toBeUndefined()
    })
  })

  describe('socialLinks parsing (update_candidate)', () => {
    it('parses a JSON array of link objects', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('update_candidate', {
          socialLinks: '[{"type":"Twitter","url":"https://twitter.com/jane"}]',
        })
      )
      expect(result.socialLinks).toEqual([{ type: 'Twitter', url: 'https://twitter.com/jane' }])
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

  describe('wandConfig on array-shaped fields', () => {
    it('does not request object-wrapped output for alternateEmailAddresses or socialLinks', () => {
      // generationType 'json-object' makes the wand API append "the response
      // must start with { and end with }", which conflicts with these fields'
      // array-or-comma-separated parsers (parseStringListInput/parseSocialLinksInput).
      const alternateEmailAddresses = AshbyBlock.subBlocks.find(
        (s) => s.id === 'alternateEmailAddresses'
      )
      const socialLinks = AshbyBlock.subBlocks.find((s) => s.id === 'socialLinks')
      expect(alternateEmailAddresses?.wandConfig?.generationType).not.toBe('json-object')
      expect(socialLinks?.wandConfig?.generationType).not.toBe('json-object')
    })

    it('does not force braces or brackets on the polymorphic fieldValue', () => {
      // fieldValue legitimately takes a bare boolean, number, string, or null,
      // so neither the 'json-object' nor the 'json-array' reinforcement applies -
      // both would make the wand emit a wrapper the field must not receive.
      const fieldValue = AshbyBlock.subBlocks.find((s) => s.id === 'fieldValue')
      expect(fieldValue?.wandConfig?.enabled).toBe(true)
      expect(fieldValue?.wandConfig?.generationType).toBeUndefined()
    })

    it('requests array output for fieldValues, whose contract is a JSON array', () => {
      const fieldValues = AshbyBlock.subBlocks.find((s) => s.id === 'fieldValues')
      expect(fieldValues?.wandConfig?.generationType).toBe('json-array')
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

    it('decodes booleans and numbers for Boolean and Number fields', () => {
      expect(parse('true')).toBe(true)
      expect(parse('42')).toBe(42)
    })

    it('decodes a JSON array for MultiValueSelect fields', () => {
      expect(parse('["Remote","Hybrid"]')).toEqual(['Remote', 'Hybrid'])
    })

    it('decodes a JSON object for Currency and range fields', () => {
      expect(parse('{"value":150000,"currencyCode":"USD"}')).toEqual({
        value: 150000,
        currencyCode: 'USD',
      })
    })

    it('passes unparseable text through as a plain string', () => {
      // A bare option name is the most common input for String, LongText, and
      // ValueSelect fields, so it must not be rejected as invalid JSON.
      expect(parse('Senior Engineer')).toBe('Senior Engineer')
    })

    it('decodes a quoted numeric string back to a string', () => {
      // The escape hatch for a String field whose value looks like a number.
      expect(parse('"123"')).toBe('123')
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

    it('passes an already-parsed value through untouched', () => {
      // An upstream block reference resolves to a real value, not to text.
      expect(parse({ value: 1 })).toEqual({ value: 1 })
      expect(parse(false)).toBe(false)
    })

    it('leaves fieldValue alone for other operations', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('list_jobs', { fieldValue: 'Senior Engineer' })
      )
      expect(result.fieldValue).toBeUndefined()
    })
  })

  describe('fieldValues parsing (set_custom_field_values)', () => {
    it('maps the fieldValues subBlock onto the tool’s values param', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('set_custom_field_values', {
          fieldValues: '[{"fieldId":"abc","fieldValue":"High"}]',
        })
      )
      expect(result.values).toEqual([{ fieldId: 'abc', fieldValue: 'High' }])
      expect(result.fieldValues).toBeUndefined()
    })

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
    it('emits sourceId as undefined when the field is left blank', () => {
      // The key must be PRESENT and undefined, not absent. The executor merges
      // `{ ...inputs, ...transformedParams }`, so an absent key inherits whatever
      // inputs held - which is exactly how a stale create-path sourceId used to
      // leak in. Presence is what overrides it.
      const result = AshbyBlock.tools.config.params!(
        buildParams('change_application_source', { applicationId: 'app-1', changeSourceId: '' })
      )
      expect(result).toHaveProperty('sourceId')
      expect(result.sourceId).toBeUndefined()
      expect(result).not.toHaveProperty('unsetSource')
    })

    it('passes unsetSource through only when the switch is on', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('change_application_source', { changeSourceId: '', unsetSource: 'true' })
      )
      expect(result.unsetSource).toBe(true)
    })

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

    it('hides the source id field while the clear switch is on', () => {
      const sourceField = AshbyBlock.subBlocks.find((s) => s.id === 'changeSourceId')
      const condition = sourceField?.condition as { and?: { field: string; not?: boolean } }
      expect(condition.and).toEqual({ field: 'unsetSource', value: true, not: true })
    })

    it('maps a provided source id onto sourceId', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('change_application_source', { changeSourceId: 'src-1' })
      )
      expect(result.sourceId).toBe('src-1')
    })

    it('does not emit a null sourceId for other operations', () => {
      // create_candidate treats an absent source as "no source", so a null here
      // would turn an omitted optional field into an explicit write.
      const result = AshbyBlock.tools.config.params!(buildParams('create_candidate', {}))
      expect(result).not.toHaveProperty('sourceId')
    })
  })

  describe('operation and tool registration stay in sync', () => {
    it('has a matching ashby_<operation> tool in access for every dropdown option', () => {
      // tools.config.tool is a bare `ashby_${operation}` concat, so a dropdown
      // option without a matching tool id resolves to a tool that does not exist.
      const operation = AshbyBlock.subBlocks.find((s) => s.id === 'operation')
      const optionIds = (operation?.options as Array<{ id: string }>).map((o) => o.id)
      const access = new Set(AshbyBlock.tools.access)
      const missing = optionIds.filter((id) => !access.has(`ashby_${id}`))
      expect(missing).toEqual([])
    })

    it('has a dropdown option for every tool listed in access', () => {
      const operation = AshbyBlock.subBlocks.find((s) => s.id === 'operation')
      const optionIds = new Set(
        (operation?.options as Array<{ id: string }>).map((o) => `ashby_${o.id}`)
      )
      const unreachable = AshbyBlock.tools.access!.filter((id) => !optionIds.has(id))
      expect(unreachable).toEqual([])
    })

    it('has a canvas sentence for every dropdown option', () => {
      const operation = AshbyBlock.subBlocks.find((s) => s.id === 'operation')
      const optionIds = (operation?.options as Array<{ id: string }>).map((o) => o.id)
      const sentences = AshbyBlock.canvasPresentation?.sentences?.byOperation ?? {}
      const missing = optionIds.filter((id) => !(id in sentences))
      expect(missing).toEqual([])
    })
  })

  describe('list_jobs incremental sync', () => {
    it('offers the syncToken field on list_jobs', () => {
      // Without a sync token every scheduled run rescans the full req set.
      const syncToken = AshbyBlock.subBlocks.find((s) => s.id === 'syncToken')
      const condition = syncToken?.condition as { value: string[] }
      expect(condition.value).toContain('list_jobs')
    })

    it('maps the editor status selection to the tool array contract', () => {
      const result = AshbyBlock.tools.config.params!(
        buildParams('list_jobs', { jobStatus: 'Open' })
      )
      expect(result.status).toEqual(['Open'])
    })

    it('maps the shared draft-posting switch to the endpoint-specific parameter', () => {
      const listParams = AshbyBlock.tools.config.params!(
        buildParams('list_jobs', { includeUnpublishedJobPostingIds: true })
      )
      expect(listParams.includeUnpublishedJobPostingsIds).toBe(true)
      expect(listParams.includeUnpublishedJobPostingIds).toBeUndefined()

      const infoParams = AshbyBlock.tools.config.params!(
        buildParams('get_job', { includeUnpublishedJobPostingIds: true })
      )
      expect(infoParams.includeUnpublishedJobPostingIds).toBe(true)
      expect(infoParams.includeUnpublishedJobPostingsIds).toBeUndefined()
    })
  })

  describe('expanded list controls', () => {
    it('exposes only provider-supported pagination and sync controls', () => {
      const cursor = AshbyBlock.subBlocks.find((s) => s.id === 'cursor')
      const cursorOperations = (cursor?.condition as { value: string[] }).value
      expect(cursorOperations).not.toContain('search_candidates')
      expect(cursorOperations).not.toContain('search_jobs')

      const syncToken = AshbyBlock.subBlocks.find((s) => s.id === 'syncToken')
      const syncOperations = (syncToken?.condition as { value: string[] }).value
      expect(syncOperations).toContain('list_application_feedback')
    })

    it('exposes archived interview plans in the editor', () => {
      const includeArchived = AshbyBlock.subBlocks.find((s) => s.id === 'includeArchived')
      const operations = (includeArchived?.condition as { value: string[] }).value
      expect(operations).toContain('list_interview_plans')
    })
  })

  describe('alternate lookup identifiers', () => {
    it('does not require the Ashby UUID when an alternate lookup is supported', () => {
      const candidateId = AshbyBlock.subBlocks.find((s) => s.id === 'candidateId')
      const applicationId = AshbyBlock.subBlocks.find((s) => s.id === 'applicationId')
      const candidateRequired = candidateId?.required as { value?: string[] }
      const applicationRequired = applicationId?.required as { value?: string[] }
      expect(candidateRequired.value).not.toContain('get_candidate')
      expect(applicationRequired.value).not.toContain('get_application')
    })
  })

  describe('list_applications candidateId filter', () => {
    it('has no filterCandidateId subBlock or wiring', () => {
      // Ashby's application.list endpoint silently ignores a candidateId
      // body field (confirmed live: passing a nonexistent candidate UUID
      // still returns unfiltered results) — the correct path for a
      // candidate's applications is ashby_get_candidate's applicationIds.
      expect(AshbyBlock.subBlocks.find((s) => s.id === 'filterCandidateId')).toBeUndefined()
      const result = AshbyBlock.tools.config.params!(
        buildParams('list_applications', { filterCandidateId: 'some-id' })
      )
      expect(result.candidateId).toBeUndefined()
    })
  })
})
