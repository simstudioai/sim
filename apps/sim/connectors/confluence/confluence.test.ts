/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  escapeCql,
  isCurrentContent,
  preserveConfluenceCallouts,
} from '@/connectors/confluence/confluence'
import { htmlToPlainText } from '@/connectors/utils'

describe('escapeCql', () => {
  it.concurrent('returns plain strings unchanged', () => {
    expect(escapeCql('Engineering')).toBe('Engineering')
  })

  it.concurrent('escapes double quotes', () => {
    expect(escapeCql('say "hello"')).toBe('say \\"hello\\"')
  })

  it.concurrent('escapes backslashes', () => {
    expect(escapeCql('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it.concurrent('escapes backslashes before quotes', () => {
    expect(escapeCql('a\\"b')).toBe('a\\\\\\"b')
  })

  it.concurrent('handles empty string', () => {
    expect(escapeCql('')).toBe('')
  })

  it.concurrent('leaves other special chars unchanged', () => {
    expect(escapeCql("it's a test & <tag>")).toBe("it's a test & <tag>")
  })
})

describe('isCurrentContent', () => {
  it.concurrent('keeps current content', () => {
    expect(isCurrentContent({ id: '1', status: 'current' })).toBe(true)
  })

  it.concurrent('keeps content with no status field', () => {
    expect(isCurrentContent({ id: '1' })).toBe(true)
  })

  it.concurrent('excludes archived content', () => {
    expect(isCurrentContent({ id: '1', status: 'archived' })).toBe(false)
  })

  it.concurrent('excludes trashed and deleted content', () => {
    expect(isCurrentContent({ id: '1', status: 'trashed' })).toBe(false)
    expect(isCurrentContent({ id: '1', status: 'deleted' })).toBe(false)
  })
})

describe('preserveConfluenceCallouts', () => {
  it.concurrent('handles empty content', () => {
    expect(preserveConfluenceCallouts('')).toBe('')
  })

  it.concurrent('leaves content with no macros unchanged', () => {
    const html = '<p>Just a normal paragraph.</p>'
    expect(preserveConfluenceCallouts(html)).toContain('Just a normal paragraph.')
  })

  it.concurrent('labels a built-in warning macro and keeps its body', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-warning">' +
      '<span class="aui-icon aui-icon-small aui-iconfont-warning confluence-information-macro-icon"></span>' +
      '<div class="confluence-information-macro-body"><p>Do NOT use this form for GitLab access.</p></div>' +
      '</div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).toContain('[WARNING]')
    expect(result).toContain('Do NOT use this form for GitLab access.')
  })

  it.concurrent('labels a built-in info macro', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-information">' +
      '<div class="confluence-information-macro-body"><p>Heads up.</p></div>' +
      '</div>'
    expect(preserveConfluenceCallouts(html)).toContain('[INFO] Heads up.')
  })

  it.concurrent('labels a built-in note macro', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-note">' +
      '<div class="confluence-information-macro-body"><p>See also.</p></div>' +
      '</div>'
    expect(preserveConfluenceCallouts(html)).toContain('[NOTE] See also.')
  })

  it.concurrent('labels a built-in tip macro', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-tip">' +
      '<div class="confluence-information-macro-body"><p>Pro tip.</p></div>' +
      '</div>'
    expect(preserveConfluenceCallouts(html)).toContain('[TIP] Pro tip.')
  })

  it.concurrent('labels a generic custom-colored Panel macro using its header title', () => {
    const html =
      '<div class="panel" style="border-width: 1px;">' +
      '<div class="panelHeader" style="background-color: #ffebe6;"><b>Do NOT use this form for:</b></div>' +
      '<div class="panelContent"><p>GitLab access requests go to the private channel instead.</p></div>' +
      '</div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).toContain('[CALLOUT: Do NOT use this form for:]')
    expect(result).toContain('GitLab access requests go to the private channel instead.')
  })

  it.concurrent('falls back to a bare CALLOUT label when a Panel macro has no header text', () => {
    const html =
      '<div class="panel"><div class="panelContent"><p>Untitled panel body.</p></div></div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).toContain('[CALLOUT]')
    expect(result).toContain('Untitled panel body.')
  })

  it.concurrent(
    'keeps the exclusion marker attached to its content through htmlToPlainText, even across surrounding whitespace collapse',
    () => {
      const html =
        '<p>Intro paragraph.</p>\n\n' +
        '<div class="confluence-information-macro confluence-information-macro-warning">' +
        '<div class="confluence-information-macro-body"><p>Do NOT use this form for:</p>' +
        '<ul><li>GitLab</li></ul></div>' +
        '</div>\n\n' +
        '<p>Trailing paragraph.</p>'
      const plainText = htmlToPlainText(preserveConfluenceCallouts(html))
      expect(plainText).toContain('[WARNING] Do NOT use this form for: GitLab')
      expect(plainText).toContain('Intro paragraph.')
      expect(plainText).toContain('Trailing paragraph.')
    }
  )

  it.concurrent(
    'does not fuse adjacent paragraph and list-item text together (word-boundary regression)',
    () => {
      const html =
        '<div class="confluence-information-macro confluence-information-macro-warning">' +
        '<div class="confluence-information-macro-body">' +
        '<p>Do NOT use this form for:</p>' +
        '<ul><li>GitLab</li><li>ServiceNow</li></ul>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).not.toContain('for:GitLab')
      expect(result).not.toContain('GitLabServiceNow')
      expect(result).toContain('Do NOT use this form for: GitLab ServiceNow')
    }
  )

  it.concurrent(
    'preserves word boundaries across multiple paragraphs in a generic Panel macro',
    () => {
      const html =
        '<div class="panel"><div class="panelContent">' +
        '<p>First sentence.</p><p>Second sentence.</p>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).toContain('First sentence. Second sentence.')
      expect(result).not.toContain('sentence.Second')
    }
  )
})
