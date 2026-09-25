import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtlassianSiteNotAccessibleError } from '@/lib/atlassian/discovery'
import {
  confluenceConnector,
  confluenceStorageToPlainText,
  confluenceViewToPlainText,
  DYNAMIC_CONTENT_SKIP_REASON,
  escapeCql,
} from '@/connectors/confluence/confluence'
import { extractCursor } from '@/connectors/confluence/cursor'

/** Existing page fixtures have no files; attachment traversal has its own regression suite. */
function stubFetchWithoutAttachments(mockFetch: typeof fetch): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      return url.pathname.endsWith('/attachments')
        ? Promise.resolve(Response.json({ results: [] }))
        : mockFetch(input, init)
    })
  )
}

describe('Confluence dynamic All scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists newly accessible spaces on each sync, including old content, and follows pagination', async () => {
    const fetchMock = vi.fn()
    const page = (id: string, key: string) => ({
      id,
      type: 'page',
      status: 'current',
      title: id,
      space: { key },
      version: { number: 1 },
    })
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [page('1', 'ENG')], _links: { next: '?cursor=next' } })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [page('2', 'HR')] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [page('3', 'NEW')] })))
    stubFetchWithoutAttachments(fetchMock)
    const config = {
      domain: 'example.atlassian.net',
      spaceKey: ['*'],
      contentType: 'all',
      labelFilter: 'published',
    }
    const context = { cloudId: 'cloud-1' }
    const first = await confluenceConnector.listDocuments(
      'token',
      config,
      undefined,
      context,
      new Date()
    )
    const second = await confluenceConnector.listDocuments(
      'token',
      config,
      first.nextCursor,
      context,
      new Date()
    )
    const nextSync = await confluenceConnector.listDocuments(
      'token',
      config,
      undefined,
      { cloudId: 'cloud-1' },
      new Date()
    )
    expect(first.hasMore).toBe(true)
    expect(second.documents[0].externalId).toBe('2')
    expect(second.hasMore).toBe(false)
    expect(nextSync.documents[0].externalId).toBe('3')
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.map((url) => url.searchParams.get('cql'))).toEqual(
      Array(3).fill('type in ("page","blogpost") AND label="published"')
    )
    expect(urls[1].searchParams.get('cursor')).toBe('next')
  })

  it.each([
    {},
    { results: [], _links: { next: '?broken=cursor' } },
    { results: [], _links: { next: '?cursor=repeat' } },
  ])('rejects an incomplete search response %#', async (body) => {
    stubFetchWithoutAttachments(vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(
      confluenceConnector.listDocuments(
        'token',
        { domain: 'example.atlassian.net', spaceKey: '*' },
        'repeat',
        { cloudId: 'cloud-1' }
      )
    ).rejects.toThrow(/invalid|repeated/)
  })
})

describe('escapeCql', () => {
  it.concurrent('escapes double quotes', () => {
    expect(escapeCql('say "hello"')).toBe('say \\"hello\\"')
  })

  it.concurrent('escapes backslashes before quotes', () => {
    expect(escapeCql('a\\"b')).toBe('a\\\\\\"b')
  })
})

describe('Confluence rejected credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['discovery', 'space', 'pages', 'cql', 'content'] as const)(
    'preserves authenticated401 at the %s boundary',
    async (boundary) => {
      stubFetchWithoutAttachments(vi.fn(async () => new Response('', { status: 401 })))
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
})

describe('extractCursor', () => {
  it.concurrent('reads the cursor from a v1 CQL search next link', () => {
    // Exact shape documented for GET /wiki/rest/api/content/search.
    expect(
      extractCursor('/rest/api/content/search?cql=type=page&limit=25&cursor=raNDoMsTRiNg')
    ).toBe('raNDoMsTRiNg')
  })

  it.concurrent('url-decodes an encoded cursor value', () => {
    expect(extractCursor('/rest/api/content/search?cursor=a%2Bb%2Fc%3D')).toBe('a+b/c=')
  })

  it.concurrent('returns undefined when the source is exhausted (no next link)', () => {
    expect(extractCursor(undefined)).toBeUndefined()
    expect(extractCursor(null)).toBeUndefined()
    expect(extractCursor('')).toBeUndefined()
  })
})

describe('confluenceViewToPlainText', () => {
  it.concurrent('preserves word boundaries between a block header and its own content', () => {
    const html =
      '<div class="panel"><div class="panelHeader"><b>Warning:</b></div>' +
      '<div class="panelContent"><p>See replacement form.</p></div></div>'
    const result = confluenceViewToPlainText(html)
    expect(result).toContain('[CALLOUT: Warning:] See replacement form.')
  })

  it.concurrent('drops app macro bootstrap scripts, inline styles, and chart data', () => {
    const html =
      '<p><style>[data-colorid=yr9gnc4vid]{color:#333333}</style>' +
      '<span data-colorid="yr9gnc4vid">Colored text</span></p>' +
      '<style type="text/css">/*<![CDATA[*/ div.rbtoc1748352890217 {padding: 0px;} /*]]>*/</style>' +
      '<div class="ap-container" id="ap-lucidchart"><div class="ap-content"></div>' +
      '<script class="ap-iframe-body-script">//<![CDATA[\n(function(){ var data = {"addon_key":"lucidchart-app"}; AP._createContainer(data); }());\n//]]></script></div>' +
      '<script class="chart-render-data" type="application/json">{"pluginKey": "confluence.extra.chart"}</script>' +
      '<p>After</p>'
    expect(confluenceViewToPlainText(html)).toBe('Colored text After')
  })

  it.concurrent('reduces an unresolved Jira issue macro to its issue key', () => {
    const html =
      '<p>Tracked in ' +
      '<span class="confluence-jim-macro jira-issue" data-jira-key="ENG-101">' +
      '<a href="https://example.atlassian.net/browse/ENG-101" class="jira-issue-key">' +
      '<span class="aui-icon aui-icon-wait issue-placeholder"></span>ENG-101</a> - ' +
      '<span class="summary">Getting issue details...</span> ' +
      '<span class="aui-lozenge aui-lozenge-subtle aui-lozenge-default issue-placeholder">STATUS</span>' +
      '</span> and ' +
      '<span class="confluence-jim-macro jira-issue conf-macro output-block">' +
      '<a href="https://example.atlassian.net/browse/ENG-102" class="jira-issue-key">' +
      '<span class="aui-icon aui-icon-wait issue-placeholder"> </span>ENG-102</a> - ' +
      '<span class="summary">이슈 세부사항 가져오는 중...</span> ' +
      '<span class="aui-lozenge aui-lozenge-subtle aui-lozenge-default issue-placeholder">상태</span>' +
      '</span>.</p>'
    expect(confluenceViewToPlainText(html)).toBe('Tracked in ENG-101 and ENG-102 .')
  })
})

describe('Confluence service-account site binding', () => {
  const config = { domain: 'other.atlassian.net', spaceKey: 'ENG' }
  const context = { cloudId: 'cloud-1', credentialDomain: 'bound.atlassian.net' }
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockRejectedValue(new Error('Unexpected provider request'))
    stubFetchWithoutAttachments(fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects a mismatched domain during setup without calling the provider', async () => {
    await expect(confluenceConnector.validateConfig('token', config, context)).resolves.toEqual({
      valid: false,
      error: 'Confluence domain must match the selected service account',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['listing', 'hydration', 'permissions', 'directory'] as const)(
    'rejects a mismatched domain before %s',
    async (operation) => {
      const execute = {
        listing: () => confluenceConnector.listDocuments('token', config, undefined, context),
        hydration: () => confluenceConnector.getDocument('token', config, 'page-1', context),
        permissions: () => confluenceConnector.getDocumentAcls!('token', config, [], context),
        directory: () => confluenceConnector.openDirectory!('token', config, context),
      }
      await expect(execute[operation]()).rejects.toThrow(
        'Confluence domain must match the selected service account'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
})

describe('Confluence listing limits', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const config = { domain: 'example.atlassian.net', spaceKey: 'ENG', maxPages: '2' }
  let context: Record<string, unknown>

  function listing(ids: string[], next?: string): Response {
    return Response.json({
      results: ids.map((id) => ({ id, title: id, status: 'current', version: { number: 1 } })),
      _links: next ? { next: `/wiki/api/v2/content?cursor=${next}` } : {},
    })
  }

  beforeEach(() => {
    fetchMock.mockReset()
    stubFetchWithoutAttachments(fetchMock)
    context = { cloudId: 'cloud-1', spaceId: 'space-1' }
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([{ contentType: 'page' }, { contentType: 'blogpost' }, { labelFilter: 'published' }])(
    'trims a partially consumed final provider page for %j and suppresses deletion reconciliation',
    async (options) => {
      fetchMock.mockResolvedValueOnce(listing(['one', 'two', 'three']))
      const result = await confluenceConnector.listDocuments(
        'token',
        { ...config, ...options },
        undefined,
        context
      )
      expect(result.documents.map((document) => document.externalId)).toEqual(['one', 'two'])
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeUndefined()
      expect(context).toMatchObject({ totalDocsFetched: 2, listingCapped: true })
    }
  )

  it.each([undefined, 'next'])(
    'distinguishes source exhaustion from an unread cursor %s',
    async (next) => {
      fetchMock.mockResolvedValueOnce(listing(['one', 'two'], next))
      const result = await confluenceConnector.listDocuments('token', config, undefined, context)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeUndefined()
      expect(context.listingCapped).toBe(next ? true : undefined)
    }
  )

  it('stops a compound cursor when blog posts consume the budget while pages remain', async () => {
    fetchMock
      .mockResolvedValueOnce(listing(['page-one'], 'next-page'))
      .mockResolvedValueOnce(listing(['blog-one']))
    const result = await confluenceConnector.listDocuments(
      'token',
      { ...config, contentType: 'all' },
      undefined,
      context
    )
    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(context.listingCapped).toBe(true)
  })

  it('keeps uncapped listings complete and preserves both content-type cursors', async () => {
    fetchMock
      .mockResolvedValueOnce(listing(['page-one', 'page-two'], 'next-page'))
      .mockResolvedValueOnce(listing(['blog-one', 'blog-two'], 'next-blog'))
    const result = await confluenceConnector.listDocuments(
      'token',
      { ...config, contentType: 'all', maxPages: '0' },
      undefined,
      context
    )
    expect(result.documents).toHaveLength(4)
    expect(result.hasMore).toBe(true)
    expect(
      JSON.parse(JSON.parse(result.nextCursor!.slice('attachments:'.length)).parentCursor)
    ).toEqual({
      page: 'next-page',
      blog: 'next-blog',
      pagesDone: false,
      blogsDone: false,
    })
    expect(context.listingCapped).toBeUndefined()
  })
})

describe('confluenceStorageToPlainText', () => {
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
    stubFetchWithoutAttachments(
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
    ).resolves.toMatchObject({
      content: '',
      skippedReason: DYNAMIC_CONTENT_SKIP_REASON,
      skippedExistingDisposition: 'replace',
    })
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
        if (url.pathname.endsWith('/attachments')) return Response.json({ results: [] })
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
          ? 'confluence:storage-local-body-v2:shared-page:1'
          : 'confluence:view-text-v2:shared-page:1'

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
    stubFetchWithoutAttachments(fetchMock)
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
      { cloudId: 'cloud-1' },
      { persistGroupMembership: vi.fn().mockResolvedValue(undefined) }
    )

    expect(acls).toEqual({
      'eng-page': ['g:confluence:cloud-1:space-readers:1'],
      'hr-post': ['g:confluence:cloud-1:space-readers:2'],
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
      { cloudId: 'cloud-1' },
      { persistGroupMembership: vi.fn().mockResolvedValue(undefined) }
    )

    expect(acls).toEqual({ 'eng-page': ['g:confluence:cloud-1:space-readers:1'] })
  })

  it('withholds only the failed space when its audience cannot be refreshed', async () => {
    site()
    const healthy = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes('/spaces/2/permissions') ? jsonResponse({}, 403) : healthy(input, init)
    )
    const persistGroupMembership = vi.fn().mockResolvedValue(undefined)
    const acls = await confluenceConnector.getDocumentAcls?.(
      'token',
      { domain: 'example.atlassian.net', spaceKey: ['ENG', 'HR'] },
      [page('eng', 'ENG'), page('hr', 'HR')],
      { cloudId: 'cloud-1' },
      { persistGroupMembership }
    )
    expect(acls).toEqual({ eng: ['g:confluence:cloud-1:space-readers:1'] })
    expect(persistGroupMembership).toHaveBeenCalledOnce()
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
      { cloudId: 'cloud-1' },
      { persistGroupMembership: vi.fn().mockResolvedValue(undefined) }
    )
    expect(acls?.['eng-page']).toEqual({
      acl: ['g:confluence:cloud-1:space-readers:1'],
      requirements: expect.arrayContaining([
        ['g:confluence:cloud-1:group-eng-page'],
        ['g:confluence:cloud-1:group-parent'],
        ['g:confluence:cloud-1:group-grandparent'],
      ]),
    })
  })
})
