/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AtlassianSiteNotAccessibleError,
  AtlassianSiteNotMatchedError,
} from '@/lib/atlassian/discovery'
import {
  buildLastModifiedClause,
  confluenceConnector,
  confluenceStorageToPlainText,
  escapeCql,
  isCurrentContent,
  preserveConfluenceCallouts,
  readIncludedLabels,
} from '@/connectors/confluence/confluence'
import { extractCursor } from '@/connectors/confluence/cursor'
import { htmlToPlainText } from '@/connectors/utils'

describe('Confluence service-account scopes', () => {
  it('requests metadata and role reads needed for complete mirrored ACLs', () => {
    expect(confluenceConnector.auth.mode).toBe('oauth')
    if (confluenceConnector.auth.mode !== 'oauth') throw new Error('Expected OAuth authentication')
    expect(confluenceConnector.auth.serviceAccountScopes).toEqual(
      expect.arrayContaining([
        'read:content.metadata:confluence',
        'read:space.permission:confluence',
        'read:group:confluence',
        'read:user:confluence',
      ])
    )
  })
})

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

describe('buildLastModifiedClause', () => {
  const now = new Date('2026-09-01T12:00:00Z')

  it.concurrent('rounds the watermark up to whole minutes relative to the server clock', () => {
    expect(buildLastModifiedClause(new Date('2026-09-01T11:30:30Z'), now)).toBe(
      'lastModified >= now("-30m")'
    )
  })

  it.concurrent('never asks for less than a minute', () => {
    expect(buildLastModifiedClause(now, now)).toBe('lastModified >= now("-1m")')
    expect(buildLastModifiedClause(new Date(now.getTime() + 60_000), now)).toBe(
      'lastModified >= now("-1m")'
    )
  })
})

describe('Confluence rejected credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['discovery', 'space', 'pages', 'cql', 'content'] as const)(
    'preserves authenticated401 at the %s boundary',
    async (boundary) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status: 401 }))
      )
      const config = {
        domain: 'revocation-fixture.atlassian.net',
        spaceKey: 'ENG',
        ...(boundary === 'cql' ? { labelFilter: 'fixture' } : {}),
      }
      const context =
        boundary === 'discovery'
          ? {}
          : { cloudId: 'cloud', ...(boundary === 'pages' ? { spaceId: 'space' } : {}) }
      const request =
        boundary === 'content'
          ? confluenceConnector.getDocument('token', config, 'page', context)
          : confluenceConnector.listDocuments('token', config, undefined, context)
      const error = await request.catch((error: unknown) => error)
      expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(true)
    }
  )

  it.each([403, 404, 429, 503])('does not invalidate credentials for status%s', (status) => {
    const error = Object.assign(new Error('Provider request failed'), { status })
    expect(confluenceConnector.isCredentialInvalidError?.(error)).toBe(false)
  })
})

describe('confluence listing scope classification', () => {
  it.concurrent('treats a token that reaches no Atlassian site as not on the site', () => {
    expect(
      confluenceConnector.isListingScopeUnavailableError?.(
        new AtlassianSiteNotAccessibleError('none')
      )
    ).toBe(true)
  })

  it.concurrent('treats a token that reaches only other Atlassian sites the same way', () => {
    expect(
      confluenceConnector.isListingScopeUnavailableError?.(
        new AtlassianSiteNotMatchedError('elsewhere')
      )
    ).toBe(true)
  })

  it.concurrent('leaves other failures for the sync engines to retry', () => {
    expect(confluenceConnector.isListingScopeUnavailableError?.(new Error('boom'))).toBe(false)
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

describe('extractCursor', () => {
  it.concurrent('reads the cursor from a v1 CQL search next link', () => {
    // Exact shape documented for GET /wiki/rest/api/content/search.
    expect(
      extractCursor('/rest/api/content/search?cql=type=page&limit=25&cursor=raNDoMsTRiNg')
    ).toBe('raNDoMsTRiNg')
  })

  it.concurrent('reads the cursor from a v2 relative next link', () => {
    expect(extractCursor('/wiki/api/v2/spaces/123/pages?limit=250&cursor=abc123')).toBe('abc123')
  })

  it.concurrent('url-decodes an encoded cursor value', () => {
    expect(extractCursor('/rest/api/content/search?cursor=a%2Bb%2Fc%3D')).toBe('a+b/c=')
  })

  it.concurrent('returns undefined when the source is exhausted (no next link)', () => {
    expect(extractCursor(undefined)).toBeUndefined()
    expect(extractCursor(null)).toBeUndefined()
    expect(extractCursor('')).toBeUndefined()
  })

  it.concurrent('returns undefined for a next link carrying no cursor', () => {
    expect(extractCursor('/rest/api/content/search?cql=type=page&limit=25')).toBeUndefined()
  })

  it.concurrent('returns undefined for a non-string next link', () => {
    expect(extractCursor({ href: '/x?cursor=a' })).toBeUndefined()
    expect(extractCursor(42)).toBeUndefined()
  })

  it.concurrent('handles an absolute next link', () => {
    expect(extractCursor('https://api.atlassian.com/wiki/api/v2/pages?cursor=xyz')).toBe('xyz')
  })
})

describe('readIncludedLabels', () => {
  it.concurrent('reads names from the include-labels wrapper', () => {
    expect(
      readIncludedLabels({
        labels: {
          results: [
            { id: '1', name: 'engineering' },
            { id: '2', name: 'published' },
          ],
        },
      })
    ).toEqual(['engineering', 'published'])
  })

  it.concurrent('returns an empty array when labels are absent or empty', () => {
    expect(readIncludedLabels({})).toEqual([])
    expect(readIncludedLabels({ labels: {} })).toEqual([])
    expect(readIncludedLabels({ labels: { results: [] } })).toEqual([])
  })

  it.concurrent('drops entries with a missing or empty name rather than emitting blanks', () => {
    expect(
      readIncludedLabels({ labels: { results: [{ id: '1' }, { name: '' }, { name: 'kept' }] } })
    ).toEqual(['kept'])
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

  it.concurrent('preserves word boundaries between a block header and its own content', () => {
    const html =
      '<div class="panel"><div class="panelHeader"><b>Warning:</b></div>' +
      '<div class="panelContent"><p>See replacement form.</p></div></div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).toContain('[CALLOUT: Warning:] See replacement form.')
  })

  it.concurrent(
    'keeps a rich header with a real source space intact, without adding a second one',
    () => {
      const html =
        '<div class="panel"><div class="panelHeader"><b>Warning:</b> <span>Do not use</span></div>' +
        '<div class="panelContent"><p>See replacement form.</p></div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).toContain('[CALLOUT: Warning: Do not use]')
    }
  )

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

  it.concurrent(
    'does not duplicate or fuse text from a nested list inside a callout body (nesting regression)',
    () => {
      const html =
        '<div class="confluence-information-macro confluence-information-macro-note">' +
        '<div class="confluence-information-macro-body">' +
        '<ul><li>Outer item' +
        '<ul><li>Nested item A</li><li>Nested item B</li></ul>' +
        '</li><li>Outer item two</li></ul>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      // Each nested <li>'s text must appear exactly once, not duplicated by the
      // outer <li> also being matched and its .text() recursing into it.
      const occurrences = (result.match(/Nested item A/g) ?? []).length
      expect(occurrences).toBe(1)
      expect(result).not.toContain('Nested item ANested item B')
      expect(result).toContain('Outer item Nested item A Nested item B Outer item two')
    }
  )

  it.concurrent('does not fuse text from a blockquote nested inside a table cell', () => {
    const html =
      '<div class="panel"><div class="panelContent">' +
      '<table><tr><td>Cell text<blockquote><p>quoted text</p></blockquote>after quote</td></tr></table>' +
      '</div></div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).not.toContain('quotedtext')
    expect(result).not.toContain('textafter')
    expect(result).toContain('Cell text quoted text after quote')
  })

  it.concurrent(
    'does not inject an artificial space into inline-formatted text mid-word (inline vs. block regression)',
    () => {
      const html =
        '<div class="panel"><div class="panelContent">' +
        '<p>This is un<b>believe</b>able.</p>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).not.toContain('un believe able')
      expect(result).toContain('This is unbelieveable.')
    }
  )

  it.concurrent('does not inject a space before punctuation carried by an inline tag', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-warning">' +
      '<div class="confluence-information-macro-body"><p>Do not proceed<b>!</b></p></div>' +
      '</div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).not.toContain('proceed !')
    expect(result).toContain('[WARNING] Do not proceed!')
  })

  it.concurrent('keeps natural word spacing when inline tags wrap a whole word', () => {
    const html =
      '<div class="panel"><div class="panelContent">' +
      '<p>Do <b>NOT</b> use this form.</p>' +
      '</div></div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).toContain('Do NOT use this form.')
  })

  it.concurrent(
    'labels a nested panel-in-panel with both its own and its parent label (nesting regression)',
    () => {
      const html =
        '<div class="panel"><div class="panelHeader"><b>Outer</b></div><div class="panelContent">' +
        '<div class="panel"><div class="panelHeader"><b>Inner</b></div>' +
        '<div class="panelContent"><p>inner body</p></div></div>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).toContain('[CALLOUT: Outer]')
      expect(result).toContain('[CALLOUT: Inner] inner body')
    }
  )

  it.concurrent(
    'labels a nested info-macro inside a panel with its own type instead of dropping it',
    () => {
      const html =
        '<div class="panel"><div class="panelContent">' +
        '<div class="confluence-information-macro confluence-information-macro-warning">' +
        '<div class="confluence-information-macro-body"><p>Do not use this.</p></div></div>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      expect(result).toContain('[WARNING] Do not use this.')
    }
  )

  it.concurrent(
    "does not let an untitled outer panel adopt a nested panel's header as its own",
    () => {
      const html =
        '<div class="panel"><div class="panelContent">' +
        '<div class="panel"><div class="panelHeader"><b>Inner title</b></div>' +
        '<div class="panelContent"><p>inner body</p></div></div>' +
        '</div></div>'
      const result = preserveConfluenceCallouts(html)
      // The outer panel has no header of its own — it must fall back to a
      // bare [CALLOUT], not steal "Inner title" from the nested panel.
      expect(result).toContain('[CALLOUT] [CALLOUT: Inner title] inner body')
    }
  )

  it.concurrent('does not fuse text on either side of a <br> line break', () => {
    const html =
      '<div class="confluence-information-macro confluence-information-macro-warning">' +
      '<div class="confluence-information-macro-body"><p>Do NOT use this form for:<br>GitLab</p></div>' +
      '</div>'
    const result = preserveConfluenceCallouts(html)
    expect(result).not.toContain('for:GitLab')
    expect(result).toContain('[WARNING] Do NOT use this form for: GitLab')
  })
})

describe('confluence incremental CQL listing', () => {
  const fetchMock =
    vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function cqlOfCall(index: number): string | null {
    return new URL(String(fetchMock.mock.calls[index][0])).searchParams.get('cql')
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps one lastModified clause across pages that straddle a minute boundary', async () => {
    const lastSyncAt = new Date('2026-09-01T11:30:00Z')
    const config = { domain: 'example.atlassian.net', spaceKey: 'ENG' }
    const syncContext: Record<string, unknown> = { cloudId: 'cloud-1' }
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          results: [],
          _links: { next: '/wiki/rest/api/content/search?cursor=page-2&cql=ignored' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    vi.setSystemTime(new Date('2026-09-01T12:00:59Z'))
    const first = await confluenceConnector.listDocuments(
      'token',
      config,
      undefined,
      syncContext,
      lastSyncAt
    )
    expect(first.nextCursor).toBe('page-2')

    vi.setSystemTime(new Date('2026-09-01T12:01:01Z'))
    await confluenceConnector.listDocuments(
      'token',
      config,
      first.nextCursor,
      syncContext,
      lastSyncAt
    )

    expect(cqlOfCall(0)).toContain('lastModified >= now("-31m")')
    expect(cqlOfCall(1)).toBe(cqlOfCall(0))
  })
})

describe('confluenceStorageToPlainText', () => {
  it('preserves rich text, word boundaries, link labels, and encoded literals', () => {
    const storage =
      '<h2>Overview</h2><p>Un<strong>break</strong>able &amp; readable.</p>' +
      '<ul><li>First</li><li>Second</li></ul>' +
      '<table><tbody><tr><td>Name</td><td>Value</td></tr></tbody></table>' +
      '<p><ac:link><ri:page ri:content-title="Another page" />' +
      '<ac:plain-text-link-body><![CDATA[Read <more>]]></ac:plain-text-link-body></ac:link>' +
      '&nbsp;Next</p>'

    expect(confluenceStorageToPlainText(storage)).toBe(
      'Overview Unbreakable & readable. First Second Name Value Read <more> Next'
    )
  })

  it('retains nested local callouts and literal code without indexing macro parameters', () => {
    const storage =
      '<ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">Caution</ac:parameter>' +
      '<ac:parameter ac:name="borderColor">#ff0000</ac:parameter><ac:rich-text-body>' +
      '<p>Outer body</p><ac:structured-macro ac:name="warning"><ac:rich-text-body>' +
      '<p>Do not run:</p><ac:structured-macro ac:name="code"><ac:parameter ac:name="language">xml</ac:parameter>' +
      '<ac:plain-text-body><![CDATA[<delete key="all" />]]></ac:plain-text-body>' +
      '</ac:structured-macro></ac:rich-text-body></ac:structured-macro>' +
      '</ac:rich-text-body></ac:structured-macro>'

    expect(confluenceStorageToPlainText(storage)).toBe(
      '[CALLOUT: Caution] Outer body [WARNING] Do not run: <delete key="all" />'
    )
  })

  it('omits inclusion references, remote macro bodies, and extension metadata', () => {
    const storage =
      '<p>Public body</p><ac:macro ac:name="excerpt-include">' +
      '<ac:default-parameter>PRIVATE:Salary</ac:default-parameter></ac:macro>' +
      '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="jql">private-project</ac:parameter>' +
      '<ac:rich-text-body><p>Cached private issue</p></ac:rich-text-body></ac:structured-macro>' +
      '<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="parameters">' +
      'remote-parameters</ac:adf-attribute></ac:adf-node></ac:adf-extension>'

    expect(confluenceStorageToPlainText(storage)).toBe('Public body')
  })

  it.each(['expand', 'excerpt', 'noformat'])(
    'retains the authored content of the %s macro',
    (name) => {
      const storage =
        `<ac:structured-macro ac:name="${name}"><ac:plain-text-body>` +
        '<![CDATA[Locally authored content]]></ac:plain-text-body></ac:structured-macro>'
      expect(confluenceStorageToPlainText(storage)).toBe('Locally authored content')
    }
  )
})

describe('Confluence permission-scoped content', () => {
  const config = { domain: 'example.atlassian.net', spaceKey: 'ENG' }
  const storage =
    '<p>Shared handbook</p>' +
    '<ac:structured-macro ac:name="include">' +
    '<ac:parameter ac:name=""><ri:page ri:content-title="Restricted compensation" /></ac:parameter>' +
    '</ac:structured-macro>' +
    '<ac:structured-macro ac:name="info">' +
    '<ac:rich-text-body><p>Local information</p></ac:rich-text-body>' +
    '</ac:structured-macro>'
  const view = '<p>Shared handbook</p><p>CONFIDENTIAL SALARY DATA</p><p>Local information</p>'

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const format = new URL(String(input)).searchParams.get('body-format')
        return new Response(
          JSON.stringify({
            id: 'shared-page',
            title: 'Shared handbook',
            status: 'current',
            spaceId: 'space-1',
            version: { number: 1 },
            body: { [format ?? 'view']: { value: format === 'storage' ? storage : view } },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    { bodyFormat: 'view', mode: {} },
    { bodyFormat: 'storage', mode: { mirrorsSourceAcls: true } },
    { bodyFormat: 'storage', mode: { perMemberListing: true, memberId: 'member-1' } },
  ])(
    'authoritatively skips verified empty $bodyFormat content for $mode',
    async ({ bodyFormat, mode }) => {
      for (const value of ['', ' \n ', '<p> </p>']) {
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'empty-page',
              title: 'Empty page',
              version: { number: 3 },
              body: { [bodyFormat]: { value } },
            })
          )
        )
        await expect(
          confluenceConnector.getDocument('token', config, 'empty-page', {
            cloudId: 'cloud-1',
            ...mode,
          })
        ).resolves.toMatchObject({
          externalId: 'empty-page',
          content: '',
          contentDeferred: false,
          skippedReason: 'Document contains no extractable text',
          skippedExistingDisposition: 'replace',
          skippedRetryPolicy: bodyFormat === 'storage' ? 'source-change' : undefined,
        })
      }
    }
  )

  it.each([
    { bodyFormat: 'view', mode: {} },
    { bodyFormat: 'storage', mode: { mirrorsSourceAcls: true } },
    { bodyFormat: 'storage', mode: { perMemberListing: true } },
  ])(
    'rejects missing and malformed $bodyFormat content for $mode',
    async ({ bodyFormat, mode }) => {
      for (const body of [
        undefined,
        null,
        {},
        { [bodyFormat]: {} },
        { [bodyFormat]: { value: null } },
        { [bodyFormat]: { value: 42 } },
      ]) {
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'page',
              version: { number: 3 },
              body,
            })
          )
        )
        await expect(
          confluenceConnector.getDocument('token', config, 'page', { cloudId: 'cloud-1', ...mode })
        ).rejects.toThrow(`missing its ${bodyFormat} body`)
      }
    }
  )

  it('skips scoped inclusion-only pages without rendering another page into their ACL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'page',
          version: { number: 3 },
          body: {
            storage: {
              value:
                '<ac:structured-macro ac:name="include"><ac:parameter ac:name="">Restricted page</ac:parameter></ac:structured-macro>',
            },
            view: { value: 'CONFIDENTIAL SALARY DATA' },
          },
        })
      )
    )
    await expect(
      confluenceConnector.getDocument('token', config, 'page', {
        cloudId: 'cloud-1',
        mirrorsSourceAcls: true,
      })
    ).resolves.toMatchObject({ content: '', skippedExistingDisposition: 'replace' })
  })

  it('keeps skipped pages retryable when no usable source version is available', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'page',
          body: { storage: { value: '' } },
        })
      )
    )
    const document = await confluenceConnector.getDocument('token', config, 'page', {
      cloudId: 'cloud-1',
      mirrorsSourceAcls: true,
    })
    expect(document?.skippedReason).toBe('Document contains no extractable text')
    expect(document?.skippedRetryPolicy).toBeUndefined()
  })

  it.each([{ mirrorsSourceAcls: true }, { perMemberListing: true, memberId: 'member-1' }])(
    'keeps external restricted content out of a shared page for %j',
    async (mode) => {
      const document = await confluenceConnector.getDocument(
        'authorized-reader',
        config,
        'shared-page',
        {
          cloudId: 'cloud-1',
          ...mode,
        }
      )

      expect(document?.content).toContain('Shared handbook')
      expect(document?.content).toContain('Local information')
      expect(document?.content).not.toContain('CONFIDENTIAL SALARY DATA')
      expect(document?.contentHash).toContain('storage')
    }
  )

  it('retains rendered inclusions for ordinary workspace knowledge bases', async () => {
    const document = await confluenceConnector.getDocument(
      'workspace-account',
      config,
      'shared-page',
      {
        cloudId: 'cloud-1',
      }
    )

    expect(document?.content).toContain('CONFIDENTIAL SALARY DATA')
    expect(document?.contentHash).toBe('confluence:view-callouts:shared-page:1')
  })

  it('rejects a missing storage body without falling back to rendered content', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'shared-page',
          version: { number: 1 },
          body: { view: { value: view } },
        })
      )
    )

    await expect(
      confluenceConnector.getDocument('token', config, 'shared-page', {
        cloudId: 'cloud-1',
        mirrorsSourceAcls: true,
      })
    ).rejects.toThrow('missing its storage body')
  })

  it.each([{ mirrorsSourceAcls: true }, { perMemberListing: true, memberId: 'member-1' }, {}])(
    'keeps v2, CQL, and hydration hashes consistent for %j',
    async (mode) => {
      const content = {
        id: 'shared-page',
        title: 'Shared handbook',
        status: 'current',
        spaceId: 'space-1',
        version: { number: 1 },
      }
      vi.mocked(fetch).mockImplementation(async (input) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith('/spaces')) {
          return new Response(JSON.stringify({ results: [{ id: 'space-1', key: 'ENG' }] }))
        }
        const format = url.searchParams.get('body-format')
        return new Response(
          JSON.stringify(
            format
              ? { ...content, body: { [format]: { value: format === 'storage' ? storage : view } } }
              : { results: [content] }
          )
        )
      })
      const context = { cloudId: 'cloud-1', ...mode }
      const v2 = await confluenceConnector.listDocuments('token', config, undefined, { ...context })
      const cql = await confluenceConnector.listDocuments(
        'token',
        { ...config, labelFilter: 'published' },
        undefined,
        { ...context }
      )
      const hydrated = await confluenceConnector.getDocument(
        'token',
        config,
        'shared-page',
        context
      )
      const expectedHash =
        'mirrorsSourceAcls' in mode || 'perMemberListing' in mode
          ? 'confluence:storage-local-body-v1:shared-page:1'
          : 'confluence:view-callouts:shared-page:1'

      expect(v2.documents[0].contentHash).toBe(expectedHash)
      expect(cql.documents[0].contentHash).toBe(expectedHash)
      expect(hydrated?.contentHash).toBe(expectedHash)
    }
  )
})

describe('confluence mirrored permissions', () => {
  const fetchMock =
    vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /** A two-space site where each space is readable by one different person. */
  function site() {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      const path = url.pathname
      if (path.endsWith('/api/v2/spaces')) {
        const key = url.searchParams.get('keys')
        return jsonResponse({ results: [{ id: key === 'ENG' ? '1' : '2', key }] })
      }
      if (path.endsWith('/spaces/1/permissions')) {
        return jsonResponse({
          results: [
            {
              principal: { type: 'user', id: 'acc-eng' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      }
      if (path.endsWith('/spaces/2/permissions')) {
        return jsonResponse({
          results: [
            {
              principal: { type: 'user', id: 'acc-hr' },
              operation: { key: 'read', targetType: 'space' },
            },
          ],
        })
      }
      if (path.includes('/restriction/byOperation/read')) {
        return jsonResponse({ restrictions: { user: { results: [] }, group: { results: [] } } })
      }
      if (path.endsWith('/ancestors')) return jsonResponse({ results: [] })
      return jsonResponse({ error: `unexpected ${path}` }, 500)
    })
  }

  function page(externalId: string, spaceKey: string, contentType = 'page') {
    return {
      externalId,
      title: externalId,
      content: '',
      mimeType: 'text/plain',
      contentHash: externalId,
      metadata: { spaceKey, contentType },
    }
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * The bug this pins: a connector over two spaces once pooled every space's
   * readers and gave the pool to every unrestricted page, so a reader of one
   * space could read the other's pages.
   */
  it("gives an unrestricted page its own space's readers, never another space's", async () => {
    site()

    const acls = await confluenceConnector.getDocumentAcls?.(
      'token',
      { domain: 'example.atlassian.net', spaceKey: ['ENG', 'HR'] },
      [page('eng-page', 'ENG'), page('hr-post', 'HR', 'blogpost')],
      { cloudId: 'cloud-1' }
    )

    expect(acls).toEqual({
      'eng-page': ['s:confluence:-:acc-eng'],
      'hr-post': ['s:confluence:-:acc-hr'],
    })
    /** A blog post has no ancestors and is never asked for them. */
    const asked = fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
    expect(asked.some((path) => path.includes('/blogposts/hr-post/ancestors'))).toBe(false)
    expect(asked.some((path) => path.includes('/pages/eng-page/ancestors'))).toBe(true)
    expect(asked.some((path) => path.includes('/user/'))).toBe(false)
  })

  it('omits a page whose permissions could not be read and still answers for the rest', async () => {
    site()
    const healthy = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes('/content/broken/restriction')) {
        return jsonResponse({ error: 'nope' }, 404)
      }
      return healthy(input, init)
    })

    const acls = await confluenceConnector.getDocumentAcls?.(
      'token',
      { domain: 'example.atlassian.net', spaceKey: 'ENG' },
      [page('eng-page', 'ENG'), page('broken', 'ENG')],
      { cloudId: 'cloud-1' }
    )

    expect(acls).toEqual({ 'eng-page': ['s:confluence:-:acc-eng'] })
  })

  it('loads restrictions above the first ancestor batch even when the page and parent already restrict access', async () => {
    site()
    const healthy = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/pages/eng-page/ancestors'))
        return jsonResponse({ results: [{ id: 'parent' }] })
      if (path.endsWith('/pages/parent/ancestors'))
        return jsonResponse({ results: [{ id: 'grandparent' }] })
      if (path.endsWith('/ancestors')) return jsonResponse({ results: [] })
      const match = path.match(/\/content\/([^/]+)\/restriction\/byOperation\/read/)
      if (match) {
        return jsonResponse({
          restrictions: {
            user: { results: [] },
            group: { results: [{ id: `group-${match[1]}` }] },
          },
        })
      }
      return healthy(input, init)
    })
    const acls = await confluenceConnector.getDocumentAcls?.(
      'token',
      { domain: 'example.atlassian.net', spaceKey: 'ENG' },
      [page('eng-page', 'ENG')],
      { cloudId: 'cloud-1' }
    )
    expect(acls?.['eng-page']).toEqual({
      acl: ['s:confluence:-:acc-eng'],
      requirements: expect.arrayContaining([
        ['g:confluence:cloud-1:group-eng-page'],
        ['g:confluence:cloud-1:group-parent'],
        ['g:confluence:cloud-1:group-grandparent'],
      ]),
    })
  })
})
