/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildFilePreviewText } from '@/lib/copilot/tools/server/files/file-preview'

describe('buildFilePreviewText', () => {
  it('returns the full streamed content for update previews', () => {
    expect(
      buildFilePreviewText({
        operation: 'update',
        streamedContent: '',
      })
    ).toBe('')

    expect(
      buildFilePreviewText({
        operation: 'update',
        streamedContent: 'updated body',
      })
    ).toBe('updated body')
  })

  it('builds append previews from the existing file content', () => {
    expect(
      buildFilePreviewText({
        operation: 'append',
        existingContent: 'line one',
        streamedContent: 'line two',
      })
    ).toBe('line one\nline two')
  })

  it('fails closed (returns undefined) for an append when the base content has not loaded', () => {
    // A base-less append preview is just the streamed fragment; a collaborative editor applying it as the
    // full body would reconcile the seeded doc down to that fragment (a wipe). It must fail closed until
    // the base loads, exactly like patch/update.
    expect(
      buildFilePreviewText({
        operation: 'append',
        existingContent: undefined,
        streamedContent: 'orphan fragment',
      })
    ).toBeUndefined()
  })

  it('still previews an append into an EMPTY file (existingContent is "", not undefined)', () => {
    expect(
      buildFilePreviewText({
        operation: 'append',
        existingContent: '',
        streamedContent: 'first line',
      })
    ).toBe('first line')
  })

  it('applies anchored replace_between previews', () => {
    expect(
      buildFilePreviewText({
        operation: 'patch',
        existingContent: ['# Title', 'before', 'after', 'footer'].join('\n'),
        streamedContent: 'replacement',
        edit: {
          strategy: 'anchored',
          mode: 'replace_between',
          before_anchor: '# Title',
          after_anchor: 'after',
        },
      })
    ).toBe(['# Title', 'replacement', 'after', 'footer'].join('\n'))
  })

  it('applies delete_between previews without streamed replacement text', () => {
    expect(
      buildFilePreviewText({
        operation: 'patch',
        existingContent: ['keep', 'start', 'remove me', 'end', 'keep too'].join('\n'),
        streamedContent: '',
        edit: {
          strategy: 'anchored',
          mode: 'delete_between',
          start_anchor: 'start',
          end_anchor: 'end',
        },
      })
    ).toBe(['keep', 'end', 'keep too'].join('\n'))
  })

  it('applies search_replace previews', () => {
    expect(
      buildFilePreviewText({
        operation: 'patch',
        existingContent: 'hello world',
        streamedContent: 'sim',
        edit: {
          strategy: 'search_replace',
          search: 'world',
        },
      })
    ).toBe('hello sim')
  })
})
