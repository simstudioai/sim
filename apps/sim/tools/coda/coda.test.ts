/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CodaBlock } from '@/blocks/blocks/coda'
import * as codaTools from '@/tools/coda'
import { codaAddPermissionTool } from '@/tools/coda/add_permission'
import { codaCreateDocTool } from '@/tools/coda/create_doc'
import { codaCreatePageTool } from '@/tools/coda/create_page'
import { codaDeletePageContentTool } from '@/tools/coda/delete_page_content'
import { codaDeleteRowsTool } from '@/tools/coda/delete_rows'
import { codaListDocsTool } from '@/tools/coda/list_docs'
import { codaListRowsTool } from '@/tools/coda/list_rows'
import { codaPublishDocTool } from '@/tools/coda/publish_doc'
import { codaResolveBrowserLinkTool } from '@/tools/coda/resolve_browser_link'
import { codaUpdateAclSettingsTool } from '@/tools/coda/update_acl_settings'
import { codaUpdatePageTool } from '@/tools/coda/update_page'
import { codaUpdateRowTool } from '@/tools/coda/update_row'
import { codaUpsertRowsTool } from '@/tools/coda/upsert_rows'
import { buildCodaUrl, CODA_FIELD_UPDATE_RETRY, CODA_RETRY } from '@/tools/coda/utils'
import { codaWhoamiTool } from '@/tools/coda/whoami'
import { ErrorExtractorId, extractErrorMessageWithId } from '@/tools/error-extractors'
import type { OutputProperty } from '@/tools/types'

const table = { accessToken: 'token', docId: 'AbCDeFGH', tableId: 'grid-pqRst-U' }

/** Lists output paths a tool returned as null whose schema does not declare `nullable`. */
function findUndeclaredNulls(
  value: unknown,
  properties: Record<string, OutputProperty> | undefined,
  path: string
): string[] {
  if (!properties || value === null || typeof value !== 'object') return []
  return Object.entries(properties).flatMap(([key, schema]) => {
    const child = (value as Record<string, unknown>)[key]
    const childPath = `${path}.${key}`
    if (child === null) return schema.nullable ? [] : [childPath]
    if (Array.isArray(child)) {
      return child.flatMap((item) => findUndeclaredNulls(item, schema.items?.properties, childPath))
    }
    return findUndeclaredNulls(child, schema.properties, childPath)
  })
}

function resolveUrl<P>(url: string | ((params: P) => string), params: P): string {
  return typeof url === 'function' ? url(params) : url
}

describe('Coda request URLs', () => {
  it('encodes path segments and omits unset query params', () => {
    const url = resolveUrl(codaListRowsTool.request.url, {
      ...table,
      tableId: 'My Table',
      query: '"Status":"Done"',
      useColumnNames: true,
      limit: 10,
    })
    expect(url).toBe(
      'https://coda.io/apis/v1/docs/AbCDeFGH/tables/My%20Table/rows?query=%22Status%22%3A%22Done%22&useColumnNames=true&limit=10'
    )
  })

  it('rejects path traversal in resource identifiers', () => {
    expect(() => resolveUrl(codaListRowsTool.request.url, { ...table, tableId: '..' })).toThrow(
      'path traversal'
    )
  })

  it('rejects a blank browser link instead of sending no url', () => {
    expect(() =>
      resolveUrl(codaResolveBrowserLinkTool.request.url, { accessToken: 'token', url: '   ' })
    ).toThrow('url is required')
  })

  it('builds list docs URLs without a doc path', () => {
    expect(
      resolveUrl(codaListDocsTool.request.url, {
        accessToken: 'token',
        query: 'Roadmap',
        isOwner: true,
      })
    ).toBe('https://coda.io/apis/v1/docs?query=Roadmap&isOwner=true')
  })
})

describe('Coda row bodies', () => {
  it('converts column maps to cells and parses key columns', () => {
    const body = codaUpsertRowsTool.request.body!({
      ...table,
      rows: JSON.stringify([{ 'c-name': 'Apple', 'c-price': 1.25 }]),
      keyColumns: 'c-name, c-sku',
    })
    expect(body).toEqual({
      rows: [
        {
          cells: [
            { column: 'c-name', value: 'Apple' },
            { column: 'c-price', value: 1.25 },
          ],
        },
      ],
      keyColumns: ['c-name', 'c-sku'],
    })
  })

  it('passes through rows already in Coda cell format', () => {
    const cells = [{ column: 'c-name', value: 'Pear' }]
    expect(codaUpsertRowsTool.request.body!({ ...table, rows: [{ cells }] })).toEqual({
      rows: [{ cells }],
    })
  })

  it('maps a column named cells instead of reading it as the cells wrapper', () => {
    expect(
      codaUpdateRowTool.request.body!({
        ...table,
        rowId: 'i-1',
        cells: { cells: 'x', Status: 'Done' },
      })
    ).toEqual({
      row: {
        cells: [
          { column: 'cells', value: 'x' },
          { column: 'Status', value: 'Done' },
        ],
      },
    })
    expect(
      codaUpdateRowTool.request.body!({ ...table, rowId: 'i-1', cells: { cells: 'x' } })
    ).toEqual({ row: { cells: [{ column: 'cells', value: 'x' }] } })
  })

  it('rejects an empty upsert', () => {
    expect(() => codaUpsertRowsTool.request.body!({ ...table, rows: '[]' })).toThrow(
      'at least one row'
    )
  })

  it('wraps row updates in a row object', () => {
    expect(
      codaUpdateRowTool.request.body!({ ...table, rowId: 'i-1', cells: { Status: 'Done' } })
    ).toEqual({ row: { cells: [{ column: 'Status', value: 'Done' }] } })
  })

  it('accepts row IDs as a JSON array string', () => {
    expect(codaDeleteRowsTool.request.body!({ ...table, rowIds: '["i-1", "i-2"]' })).toEqual({
      rowIds: ['i-1', 'i-2'],
    })
  })
})

describe('Coda page and permission bodies', () => {
  const page = { accessToken: 'token', docId: 'AbCDeFGH', pageId: 'canvas-1' }

  it('requires an insertion mode when updating content', () => {
    expect(() => codaUpdatePageTool.request.body!({ ...page, content: '# Hi' })).toThrow(
      'insertionMode'
    )
  })

  it('builds a content update with a default markdown format', () => {
    expect(
      codaUpdatePageTool.request.body!({ ...page, content: '# Hi', insertionMode: 'append' })
    ).toEqual({
      contentUpdate: {
        insertionMode: 'append',
        canvasContent: { format: 'markdown', content: '# Hi' },
      },
    })
  })

  it('maps each principal type to its field', () => {
    const base = { accessToken: 'token', docId: 'AbCDeFGH', access: 'write' as const }
    expect(
      codaAddPermissionTool.request.body!({ ...base, principalType: 'group', principal: 'grp-1' })
    ).toEqual({ access: 'write', principal: { type: 'group', groupId: 'grp-1' } })
    expect(codaAddPermissionTool.request.body!({ ...base, principalType: 'anyone' })).toEqual({
      access: 'write',
      principal: { type: 'anyone' },
    })
    expect(() =>
      codaAddPermissionTool.request.body!({ ...base, principalType: 'email', principal: ' ' })
    ).toThrow('principal is required')
  })
})

describe('Coda block params', () => {
  const mapParams = CodaBlock.tools.config!.params!

  it('maps operation-specific inputs onto tool params', () => {
    const result = mapParams({
      operation: 'list_rows',
      rowFilter: '"Status":"Done"',
      docSearch: 'ignored',
      rowSortBy: 'updatedAt',
      limit: '50',
      useColumnNames: true,
      visibleOnly: false,
    })
    expect(result).toMatchObject({
      query: '"Status":"Done"',
      sortBy: 'updatedAt',
      limit: 50,
      useColumnNames: true,
      visibleOnly: undefined,
    })
  })

  it('routes shared params by operation and maps page visibility', () => {
    expect(
      mapParams({
        operation: 'get_mutation_status',
        mutationRequestId: 'req-1',
        workspaceFilter: 'ws-f',
      })
    ).toMatchObject({ requestId: 'req-1', workspaceId: 'ws-f' })
    expect(
      mapParams({ operation: 'create_folder', folderName: 'Plans', workspaceId: 'ws-1' })
    ).toMatchObject({ name: 'Plans', workspaceId: 'ws-1' })
    expect(mapParams({ operation: 'update_page', pageVisibility: 'hidden' })).toMatchObject({
      isHidden: true,
    })
    expect(mapParams({ operation: 'update_page', pageVisibility: 'unchanged' })).toMatchObject({
      isHidden: undefined,
    })
  })

  it('selects the tool from the operation', () => {
    expect(CodaBlock.tools.config!.tool!({ operation: 'upsert_rows' })).toBe('coda_upsert_rows')
  })
})

describe('Coda page content and publishing bodies', () => {
  it('builds embed and sync page content', () => {
    expect(
      codaCreatePageTool.request.body!({
        accessToken: 'token',
        docId: 'AbCDeFGH',
        pageType: 'embed',
        embedUrl: ' https://example.com ',
      })
    ).toEqual({ pageContent: { type: 'embed', url: 'https://example.com' } })
    expect(
      codaCreatePageTool.request.body!({
        accessToken: 'token',
        docId: 'AbCDeFGH',
        pageType: 'syncPage',
        sourceDocId: 'src',
        syncMode: 'document',
      })
    ).toEqual({ pageContent: { type: 'syncPage', mode: 'document', sourceDocId: 'src' } })
    expect(() =>
      codaCreatePageTool.request.body!({
        accessToken: 'token',
        docId: 'AbCDeFGH',
        pageType: 'syncPage',
        sourceDocId: 'src',
      })
    ).toThrow('sourcePageId')
  })

  it('nests initial page settings when creating a doc', () => {
    expect(
      codaCreateDocTool.request.body!({
        accessToken: 'token',
        title: 'Plan',
        pageName: 'Overview',
        content: '# Hi',
      })
    ).toEqual({
      title: 'Plan',
      initialPage: {
        name: 'Overview',
        pageContent: { type: 'canvas', canvasContent: { format: 'markdown', content: '# Hi' } },
      },
    })
  })

  it('only sends explicitly set sharing settings', () => {
    expect(
      codaUpdateAclSettingsTool.request.body!({
        accessToken: 'token',
        docId: 'AbCDeFGH',
        allowCopying: false,
      })
    ).toEqual({ allowCopying: false })
    expect(() =>
      codaUpdateAclSettingsTool.request.body!({ accessToken: 'token', docId: 'AbCDeFGH' })
    ).toThrow('at least one')
  })

  it('splits publish categories and omits unset fields', () => {
    expect(
      codaPublishDocTool.request.body!({
        accessToken: 'token',
        docId: 'AbCDeFGH',
        categoryNames: 'Project management, Engineering',
        mode: 'view',
      })
    ).toEqual({ categoryNames: ['Project management', 'Engineering'], mode: 'view' })
  })

  it('sends the bearer token from the resolved credential', () => {
    expect(codaWhoamiTool.request.headers({ accessToken: 'secret' })).toEqual({
      Authorization: 'Bearer secret',
      Accept: 'application/json',
    })
    expect(codaWhoamiTool.oauth).toEqual({ required: true, provider: 'coda' })
  })
})

describe('Coda delete page content', () => {
  const page = { accessToken: 'token', docId: 'AbCDeFGH', pageId: 'canvas-1' }

  it('never clears a whole page without an explicit deleteAll', () => {
    expect(() => codaDeletePageContentTool.request.body!({ ...page })).toThrow('deleteAll')
    expect(codaDeletePageContentTool.request.body!({ ...page, deleteAll: true })).toEqual({})
    expect(
      codaDeletePageContentTool.request.body!({
        ...page,
        elementIds: 'cl-1, cl-2',
        deleteAll: true,
      })
    ).toEqual({ elementIds: ['cl-1', 'cl-2'] })
  })
})

describe('Coda pagination and errors', () => {
  it('sends only the page token when continuing a list', () => {
    expect(
      buildCodaUrl('/docs/doc/tables/grid/rows', {
        limit: 10,
        useColumnNames: true,
        pageToken: 'eyJsaW1pd',
      })
    ).toBe('https://coda.io/apis/v1/docs/doc/tables/grid/rows?pageToken=eyJsaW1pd')
    expect(buildCodaUrl('/docs', { limit: 10, pageToken: '  ' })).toBe(
      'https://coda.io/apis/v1/docs?limit=10'
    )
  })

  it('surfaces Coda schema validation detail instead of a generic Bad Request', () => {
    const data = {
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Bad Request',
      codaType: 'RequestSchemaValidationFailed',
      codaDetail: {
        issues: [
          {
            code: 'invalid_union',
            errors: [
              [{ code: 'custom', message: 'Invalid pageToken', path: ['pageToken'] }],
              [
                {
                  code: 'unrecognized_keys',
                  keys: ['limit'],
                  path: [],
                  message: 'Unrecognized key: "limit"',
                },
              ],
            ],
            path: [],
            message: 'Invalid input',
          },
        ],
      },
    }
    expect(extractErrorMessageWithId({ status: 400, data }, ErrorExtractorId.CODA_ERRORS)).toBe(
      'Bad Request: pageToken: Invalid pageToken; Unrecognized key: "limit"'
    )
    expect(
      extractErrorMessageWithId(
        { status: 404, data: { statusMessage: 'Not Found', message: 'Doc has been deleted.' } },
        ErrorExtractorId.CODA_ERRORS
      )
    ).toBe('Doc has been deleted.')
  })
})

describe('Coda tool registration', () => {
  const allTools = Object.entries(codaTools).filter(([name]) => name.endsWith('Tool'))

  it('exposes all 60 tools through the barrel', () => {
    expect(allTools).toHaveLength(60)
  })

  it.each(allTools)(
    '%s declares every output it can return as null as nullable',
    async (_, tool) => {
      const config = tool as {
        outputs: Record<string, OutputProperty>
        transformResponse: (response: Response, params: object) => Promise<{ output: unknown }>
      }
      const sparseBody = {
        items: [{ doc: {}, page: {}, metrics: [{}] }],
        customDocDomains: [{}],
        resource: {},
        id: 'x',
      }
      const { output } = await config.transformResponse(
        new Response(JSON.stringify(sparseBody)),
        table
      )
      expect(findUndeclaredNulls(output, config.outputs, '')).toEqual([])
    }
  )

  it.each(allTools)(
    '%s retries safely repeatable calls and authenticates with the Coda credential',
    (_, tool) => {
      const config = tool as {
        request: { method: unknown; retry?: unknown }
        oauth?: unknown
        params: Record<string, unknown>
      }
      expect(config.request.retry).toBe(
        config.request.method === 'PATCH' ? CODA_FIELD_UPDATE_RETRY : CODA_RETRY
      )
      expect(config.oauth).toEqual({ required: true, provider: 'coda' })
      expect(config.params.accessToken).toMatchObject({ required: true, visibility: 'hidden' })
    }
  )
})
