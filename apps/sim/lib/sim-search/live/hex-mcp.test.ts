import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { readHexMcp, searchHexMcp } from '@/lib/sim-search/live/hex-mcp'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const PROJECT = '00000000-0000-4000-8000-000000000001'
const WORKSPACE = '00000000-0000-4000-8000-000000000002'
const OTHER = '00000000-0000-4000-8000-000000000003'
const REVISION = '2026-01-01T12:00:00.000Z'
const metadata = {
  id: PROJECT,
  title: 'Deployment analysis',
  description: 'Source methodology',
  type: 'PROJECT',
  lastEditedAt: REVISION,
  archivedAt: null,
  trashedAt: null,
}
const reference = { id: PROJECT, container: WORKSPACE, kind: 'project', revision: REVISION }

function cell(id: string, cellType = 'MARKDOWN', source = 'Reviewed deployment notes') {
  return {
    id,
    staticId: `static-${id}`,
    projectId: PROJECT,
    cellType,
    label: null,
    contents: {
      codeCell: cellType === 'CODE' ? { source } : null,
      sqlCell: cellType === 'SQL' ? { source, outputDataframe: 'results' } : null,
      markdownCell: cellType === 'MARKDOWN' ? { source } : null,
    },
  }
}

function client(
  options: {
    search?: unknown
    workspace?: string
    metadata?: unknown[]
    pages?: unknown[]
    projectFailure?: Error
  } = {}
) {
  let page = 0
  let metadataRead = 0
  const api: ManagedSearchMcpClient = {
    async call(name, args) {
      if (name === 'get_me') return { org: { id: options.workspace ?? WORKSPACE } }
      if (name === 'search_projects')
        return (
          options.search ?? {
            orgId: WORKSPACE,
            baseUrl: 'https://app.hex.tech',
            projects: [
              {
                projectId: PROJECT,
                title: 'Old title',
                description: 'Old description',
                type: 'app',
              },
            ],
          }
        )
      if (name === 'get_project') {
        if (args.projectId === OTHER && options.projectFailure) throw options.projectFailure
        if (args.projectId !== PROJECT) throw new Error('Unexpected project')
        return options.metadata?.[metadataRead++] ?? metadata
      }
      if (name === 'list_cells') {
        const previous = toRecord(options.pages?.[page - 1])
        if (args.after !== toRecord(previous.pagination).after)
          throw new Error('Unexpected pagination cursor')
        return options.pages?.[page++] ?? { values: [cell('one')], pagination: { after: null } }
      }
      throw new Error('Unexpected tool')
    },
  }
  return api
}

describe('Hex source retrieval', () => {
  it('hydrates current project metadata instead of presenting stale search text as evidence', async () => {
    const page = await searchHexMcp(client(), { query: 'deployment', limit: 10, scopes: [] })
    expect(page.documents).toEqual([
      expect.objectContaining({
        id: PROJECT,
        container: WORKSPACE,
        title: 'Deployment analysis',
        content: expect.stringContaining('Source methodology'),
        modifiedAt: REVISION,
      }),
    ])
    expect(page.documents[0]?.content).not.toContain('Old description')
  })

  it.each([
    { orgId: OTHER, baseUrl: 'https://app.hex.tech', projects: [] },
    { orgId: WORKSPACE, baseUrl: 'https://attacker.example', projects: [] },
    { orgId: WORKSPACE, baseUrl: 'https://app.hex.tech', projects: {} },
  ])('refuses unbound or malformed search results', async (search) => {
    await expect(
      searchHexMcp(client({ search }), { query: 'deployment', limit: 10, scopes: [] })
    ).rejects.toThrow()
  })

  it('excludes mismatched project metadata instead of returning stale search titles', async () => {
    const page = await searchHexMcp(client({ metadata: [{ ...metadata, id: OTHER }] }), {
      query: 'deployment',
      limit: 10,
      scopes: [],
    })
    expect(page.documents).toEqual([])
    expect(page.partial).toBe(true)
  })

  it.each([
    new NativeSearchError(
      'unavailable',
      'Project no longer accessible',
      undefined,
      undefined,
      'mcp_tool_error'
    ),
    new NativeSearchError('reconnect', 'Connection changed'),
    new DOMException('Search cancelled', 'AbortError'),
    new NativeSearchError('rate_limited', 'Rate limit reached'),
    new NativeSearchError(
      'unavailable',
      'Request limit reached',
      undefined,
      undefined,
      'request_budget_exceeded'
    ),
  ])(
    'isolates project read errors while preserving connection and request failures: %s',
    async (error) => {
      const result = searchHexMcp(
        client({
          search: {
            orgId: WORKSPACE,
            baseUrl: 'https://app.hex.tech',
            projects: [
              { projectId: OTHER, type: 'project' },
              { projectId: PROJECT, type: 'project' },
            ],
          },
          projectFailure: error,
        }),
        { query: 'deployment', limit: 10, scopes: [] }
      )
      if (error instanceof NativeSearchError && error.diagnosticCode === 'mcp_tool_error') {
        const page = await result
        expect(page.documents.map((document) => document.id)).toEqual([PROJECT])
        expect(page.partial).toBe(true)
      } else await expect(result).rejects.toBe(error)
    }
  )

  it.each(['', '*'])('refuses unbounded search terms', async (query) => {
    await expect(searchHexMcp(client(), { query, limit: 10, scopes: [] })).rejects.toThrow()
  })

  it('reads draft source cells in notebook order across pages and identifies omitted rendered content', async () => {
    const result = await readHexMcp(
      client({
        pages: [
          {
            values: [cell('one', 'MARKDOWN', '# Method'), cell('two', 'SQL', 'select 1')],
            pagination: { after: 'next' },
          },
          {
            values: [cell('three', 'CODE', 'print(results)'), cell('four', 'CHART')],
            pagination: { after: null },
          },
        ],
      }),
      reference
    )
    expect(result.content.indexOf('# Method')).toBeLessThan(result.content.indexOf('select 1'))
    expect(result.content.indexOf('select 1')).toBeLessThan(
      result.content.indexOf('print(results)')
    )
    expect(result.content).toMatch(/draft/i)
    expect(result.content).toMatch(/CHART/)
    expect(result.content).toMatch(/not included|not available/)
    expect(result.url).toBe(`https://app.hex.tech/${WORKSPACE}/hex/${PROJECT}/draft/logic`)
  })

  it('refuses a reference from another workspace even when its project identifier exists', async () => {
    await expect(readHexMcp(client({ workspace: OTHER }), reference)).rejects.toThrow(/workspace/i)
  })

  it('withholds notebook source when the provider workspace changes during paging', async () => {
    const api = client()
    let connectedWorkspace = WORKSPACE
    const changingWorkspace: ManagedSearchMcpClient = {
      async call(name, args) {
        if (name === 'get_me') return { org: { id: connectedWorkspace } }
        const result = await api.call(name, args)
        if (name === 'list_cells') connectedWorkspace = OTHER
        return result
      },
    }

    await expect(readHexMcp(changingWorkspace, reference)).rejects.toThrow(/workspace/i)
  })

  it.each([
    { ...metadata, id: OTHER },
    { ...metadata, trashedAt: '2026-01-01T13:00:00Z' },
    { ...metadata, lastEditedAt: '2026-01-01T13:00:00Z' },
  ])('refuses changed, deleted, or mismatched project metadata during a read', async (changed) => {
    await expect(readHexMcp(client({ metadata: [metadata, changed] }), reference)).rejects.toThrow()
  })

  it.each([
    { values: [{ ...cell('one'), projectId: OTHER }], pagination: {} },
    { values: [cell('one'), cell('one')], pagination: {} },
    {
      values: [{ ...cell('one'), contents: { codeCell: null, sqlCell: null, markdownCell: null } }],
      pagination: {},
    },
    { values: [], pagination: { after: 10 } },
  ])(
    'rejects malformed or cross-project cell data rather than silently omitting it',
    async (page) => {
      await expect(readHexMcp(client({ pages: [page] }), reference)).rejects.toThrow()
    }
  )

  it('refuses repeated pagination cursors before returning duplicate or incomplete evidence', async () => {
    await expect(
      readHexMcp(
        client({
          pages: [
            { values: [cell('one')], pagination: { after: 'loop' } },
            { values: [cell('two')], pagination: { after: 'loop' } },
          ],
        }),
        reference
      )
    ).rejects.toThrow(/pagination/i)
  })

  it('refuses content that exceeds the complete UTF-8 byte limit', async () => {
    await expect(
      readHexMcp(
        client({
          pages: [{ values: [cell('one', 'MARKDOWN', '界'.repeat(180_000))], pagination: {} }],
        }),
        reference
      )
    ).rejects.toThrow(/512 KiB/i)
  })

  it('refuses a notebook requiring more pages than the read budget', async () => {
    await expect(
      readHexMcp(
        client({
          pages: Array.from({ length: 8 }, (_, index) => ({
            values: [cell(`cell-${index}`)],
            pagination: { after: `page-${index}` },
          })),
        }),
        reference
      )
    ).rejects.toThrow(/page limit/i)
  })

  it('reads a complete eight-page notebook within the managed request budget', async () => {
    const api = client({
      pages: Array.from({ length: 8 }, (_, index) => ({
        values: [cell(`cell-${index}`, 'MARKDOWN', `Source page ${index}`)],
        pagination: { after: index === 7 ? null : `page-${index}` },
      })),
    })
    let requests = 0
    const budgetedClient: ManagedSearchMcpClient = {
      call(name, args) {
        if (++requests > 12) throw new Error('Managed request budget exceeded')
        return api.call(name, args)
      },
    }

    const result = await readHexMcp(budgetedClient, reference)
    expect(result.content).toContain('Source page 0')
    expect(result.content).toContain('Source page 7')
  })
})
