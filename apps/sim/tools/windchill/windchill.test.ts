/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { windchillOperationBodySchema } from '@/lib/api/contracts/tools/windchill'
import { WindchillBlock, WindchillBlockMeta } from '@/blocks/blocks/windchill'
import type { ToolConfig } from '@/tools/types'
import * as windchillTools from '@/tools/windchill'
import {
  WINDCHILL_AFFECTED_OUTPUTS,
  WINDCHILL_ATTACHMENTS_OUTPUTS,
  WINDCHILL_BULK_MUTATION_OUTPUTS,
  WINDCHILL_DOCUMENT_OUTPUTS,
  WINDCHILL_FILE_OUTPUTS,
  WINDCHILL_LIST_DOCUMENTS_OUTPUTS,
  WINDCHILL_OPERATIONS,
  WINDCHILL_PRIMARY_CONTENT_OUTPUTS,
  WINDCHILL_SINGLE_MUTATION_OUTPUTS,
  WINDCHILL_STATE_OUTPUTS,
  WINDCHILL_STRUCTURE_OUTPUTS,
  WINDCHILL_UPLOAD_OUTPUTS,
  type WindchillOperation,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  buildWindchillReadUrl,
  createBasicAuthHeader,
  encodeWindchillOid,
  normalizeServiceRoot,
  normalizeWindchillReadOutput,
  resolveWindchillNextLink,
  sanitizeWindchillError,
  transformWindchillDirectRead,
  transformWindchillInternalResponse,
  windchillReadHeaders,
} from '@/tools/windchill/utils'

const { mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetchWithValidation,
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
}))

import {
  createWindchillSession,
  resolveWindchillContentUrl,
  uploadWindchillContent,
  windchillMutationRequest,
} from '@/tools/windchill/utils.server'

const BASE_URL = 'https://windchill.example.com/Windchill/servlet/odata/v6'

/** Mirrors MAX_STRUCTURE_DEPTH: the deepest `DocUsageLinks` expansion the tools ever request. */
const MAX_EXPANDABLE_DEPTH = 3

function isWindchillTool(value: unknown): value is ToolConfig<WindchillParams, WindchillResponse> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('windchill_')
  )
}

const WINDCHILL_TOOLS_BY_ID = new Map(
  Object.values(windchillTools)
    .filter(isWindchillTool)
    .map((tool) => [tool.id, tool])
)

function mockResponse({
  body,
  status = 200,
  cookies = [],
  contentType = 'application/json',
  rawBody,
}: {
  body?: unknown
  status?: number
  cookies?: string[]
  contentType?: string
  rawBody?: string
}) {
  const headers = new Headers({ 'content-type': contentType })
  Object.defineProperty(headers, 'getSetCookie', { value: () => cookies })
  const text = rawBody ?? (body === undefined ? '' : JSON.stringify(body))
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers,
    body: null,
    text: async () => text,
    json: async () => body,
    arrayBuffer: async () => Buffer.from(text),
  }
}

beforeEach(() => {
  mockSecureFetchWithValidation.mockReset()
})

describe('Windchill tools', () => {
  it('defines and builds every registered operation', () => {
    expect([...WINDCHILL_TOOLS_BY_ID.keys()].sort()).toEqual([...WINDCHILL_OPERATIONS].sort())

    for (const [operation, tool] of WINDCHILL_TOOLS_BY_ID) {
      expect(tool.id).toBe(operation)
      expect(tool.params.baseUrl.visibility).toBe('user-only')
      expect(tool.params.username.visibility).toBe('user-only')
      expect(tool.params.password.visibility).toBe('user-only')

      if (typeof tool.request.url === 'function') {
        expect(tool.request.stripAuthOnRedirect).toBe(true)
      } else {
        expect(tool.request.url).toBe('/api/tools/windchill')
        expect(tool.request.internalAuth).toBe('executor_delegation')
      }
    }
  })

  it('gives every required tool param a required, non-advanced input for its operation', () => {
    const subBlocks = WindchillBlock.subBlocks
    const ALWAYS_SHOWN = new Set(['baseUrl', 'username', 'password'])
    const shownFor = (subBlock: (typeof subBlocks)[number], operation: string) => {
      const condition = subBlock.condition as { value?: unknown } | undefined
      if (!condition) return true
      const value = condition.value
      return Array.isArray(value) ? value.includes(operation) : value === operation
    }

    for (const [operation, tool] of WINDCHILL_TOOLS_BY_ID) {
      for (const [name, param] of Object.entries(tool.params)) {
        if (!param.required || ALWAYS_SHOWN.has(name)) continue
        const members = subBlocks.filter(
          (subBlock) =>
            (subBlock.canonicalParamId ?? subBlock.id) === name && shownFor(subBlock, operation)
        )
        expect(
          members.length,
          `${operation} has no input for required param ${name}`
        ).toBeGreaterThan(0)
        for (const member of members) {
          expect(member.required, `${operation}.${name} input is not required`).toBeTruthy()
        }
      }
    }
  })

  it("shows no input an operation's tool cannot accept", () => {
    const subBlocks = WindchillBlock.subBlocks
    for (const [operation, tool] of WINDCHILL_TOOLS_BY_ID) {
      const dead = subBlocks
        .filter((subBlock) => {
          if (subBlock.id === 'operation') return false
          const condition = subBlock.condition as { value?: unknown } | undefined
          if (!condition) return false
          const value = condition.value
          return Array.isArray(value) ? value.includes(operation) : value === operation
        })
        .map((subBlock) => subBlock.canonicalParamId ?? subBlock.id)
        .filter((id) => !(id in tool.params))
      expect(dead, `${operation} shows inputs its tool ignores`).toEqual([])
    }
  })

  it('wires every operation to the outputs family its producer actually emits', () => {
    const expected: Record<WindchillOperation, unknown> = {
      windchill_list_documents: WINDCHILL_LIST_DOCUMENTS_OUTPUTS,
      windchill_get_document: WINDCHILL_DOCUMENT_OUTPUTS,
      windchill_get_document_structure: WINDCHILL_STRUCTURE_OUTPUTS,
      windchill_get_valid_state_transitions: WINDCHILL_STATE_OUTPUTS,
      windchill_get_primary_content: WINDCHILL_PRIMARY_CONTENT_OUTPUTS,
      windchill_list_attachments: WINDCHILL_ATTACHMENTS_OUTPUTS,
      windchill_create_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_update_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_update_common_properties: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_check_out_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_check_in_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_undo_check_out_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_revise_document: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_set_lifecycle_state: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
      windchill_create_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_update_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_check_out_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_check_in_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_undo_check_out_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_revise_documents: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_update_document_security_labels: WINDCHILL_BULK_MUTATION_OUTPUTS,
      windchill_delete_document: WINDCHILL_AFFECTED_OUTPUTS,
      windchill_delete_documents: WINDCHILL_AFFECTED_OUTPUTS,
      windchill_download_primary_content: WINDCHILL_FILE_OUTPUTS,
      windchill_download_attachment: WINDCHILL_FILE_OUTPUTS,
      windchill_upload_primary_content: WINDCHILL_UPLOAD_OUTPUTS,
      windchill_upload_attachments: WINDCHILL_UPLOAD_OUTPUTS,
    }

    for (const [operation, tool] of WINDCHILL_TOOLS_BY_ID) {
      expect(tool.outputs).toBe(expected[operation])
    }
  })

  it('stops normalizing document structure at the expandable depth', () => {
    const link = (depth: number): Record<string, unknown> => ({
      ID: `link-${depth}`,
      DocUses: {
        ID: `doc-${depth}`,
        Name: `Child ${depth}`,
        DocUsageLinks: depth >= 6 ? [] : [link(depth + 1)],
      },
    })

    const output = normalizeWindchillReadOutput('windchill_get_document_structure', {
      value: [link(0)],
    })

    let node = output.structure?.[0]
    for (let level = 0; level <= MAX_EXPANDABLE_DEPTH; level += 1) {
      expect(node?.child?.name).toBe(`Child ${level}`)
      node = node?.children[0]
    }
    expect(node).toBeUndefined()
  })

  it('does not forward caller-supplied execution scope to the internal route', () => {
    expect(
      buildWindchillInternalBody('windchill_download_primary_content', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        documentOid: 'OR:wt.doc.WTDocument:1',
        _context: {
          workspaceId: 'forged-workspace',
          workflowId: 'forged-workflow',
          executionId: 'forged-execution',
        },
      })
    ).toEqual({
      operation: 'windchill_download_primary_content',
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      documentOid: 'OR:wt.doc.WTDocument:1',
    })
  })

  it('normalizes only a complete versioned HTTPS service root', () => {
    expect(normalizeServiceRoot(`${BASE_URL}/`)).toBe(BASE_URL)
    expect(() => normalizeServiceRoot('http://windchill.example.com/servlet/odata/v6')).toThrow(
      'must use HTTPS'
    )
    expect(() => normalizeServiceRoot('https://windchill.example.com/servlet/odata')).toThrow(
      'must end with'
    )
    expect(() => normalizeServiceRoot(`${BASE_URL}?token=secret`)).toThrow(
      'must not include credentials, query parameters, or a hash'
    )
  })

  it('builds Basic auth and safely encodes document identifiers', () => {
    expect(createBasicAuthHeader('windchill-user', 'not-a-real-password')).toBe(
      `Basic ${Buffer.from('windchill-user:not-a-real-password').toString('base64')}`
    )
    expect(encodeWindchillOid('OR:wt.doc.WTDocument:48796581')).toBe(
      'OR%3Awt.doc.WTDocument%3A48796581'
    )
    expect(() => encodeWindchillOid("OR:wt.doc.WTDocument:1' or 1 eq 1")).toThrow(
      'unsupported characters'
    )
  })

  it('builds bounded OData list queries after execution-time coercion', () => {
    const value = buildWindchillReadUrl('windchill_list_documents', {
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      select: 'ID,Name,State',
      filter: "State eq 'RELEASED'",
      orderBy: 'Name asc',
      top: 50,
      skip: 10,
      count: true,
      latestVersion: true,
    })
    const url = new URL(value)

    expect(url.pathname).toBe('/Windchill/servlet/odata/v6/DocMgmt/Documents')
    expect(url.searchParams.get('$select')).toBe('ID,Name,State')
    expect(url.searchParams.get('$filter')).toBe("State eq 'RELEASED'")
    expect(url.searchParams.get('$orderby')).toBe('Name asc')
    expect(url.searchParams.get('$top')).toBe('50')
    expect(url.searchParams.get('$skip')).toBe('10')
    expect(url.searchParams.get('$count')).toBe('true')
    expect(url.searchParams.get('ptc.search.latestversion')).toBe('true')
    expect(
      windchillReadHeaders({
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        top: 50,
      }).Prefer
    ).toBe('odata.maxpagesize=50')
    expect(() =>
      buildWindchillReadUrl('windchill_list_documents', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        select: 'ID,Name,ProviderOnlyField',
      })
    ).toThrow('select supports only normalized document properties')
    expect(() =>
      buildWindchillReadUrl('windchill_list_documents', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        top: 2001,
      })
    ).toThrow('top must be an integer between 1 and 2000')
    for (const bounded of [{ top: 0 }, { top: 1.5 }, { skip: -1 }, { structureDepth: 4 }]) {
      expect(() =>
        buildWindchillReadUrl(
          'structureDepth' in bounded
            ? 'windchill_get_document_structure'
            : 'windchill_list_documents',
          {
            baseUrl: BASE_URL,
            username: 'user',
            password: 'not-a-real-password',
            documentOid: 'OR:wt.doc.WTDocument:1',
            ...bounded,
          }
        )
      ).toThrow('must be an integer')
    }
  })

  it('sends OData expression spaces as %20 rather than form-encoded plus signs', () => {
    const value = buildWindchillReadUrl('windchill_list_documents', {
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      filter: "startswith(Name,'Demo') and Latest eq true",
      orderBy: 'Name desc',
    })

    expect(value).not.toContain('+')
    expect(value).toContain('%20and%20')
    expect(value).toContain('Name%20desc')
    expect(new URL(value).searchParams.get('$orderby')).toBe('Name desc')
  })

  it('treats a cleared subblock exactly like an absent one', () => {
    const cleared = {
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      top: '' as unknown as number,
      skip: '' as unknown as number,
      count: '' as unknown as boolean,
      latestVersion: '' as unknown as boolean,
    }

    expect(buildWindchillReadUrl('windchill_list_documents', cleared)).toBe(
      `${BASE_URL}/DocMgmt/Documents`
    )
    expect(windchillReadHeaders(cleared).Prefer).toBe('odata.maxpagesize=200')
    expect(
      buildWindchillReadUrl('windchill_get_document_structure', {
        ...cleared,
        documentOid: 'OR:wt.doc.WTDocument:1',
        structureDepth: '' as unknown as number,
      })
    ).toContain('%24expand=DocUsedBy%2CDocUses')
    expect(
      buildWindchillInternalBody('windchill_download_primary_content', {
        ...cleared,
        documentOid: 'OR:wt.doc.WTDocument:1',
        fileName: '',
      })
    ).toEqual({
      operation: 'windchill_download_primary_content',
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      documentOid: 'OR:wt.doc.WTDocument:1',
    })
  })

  it('accepts next links only for the originating collection', () => {
    const next = `${BASE_URL}/DocMgmt/Documents?%24skip=100`
    expect(resolveWindchillNextLink(BASE_URL, next, `${BASE_URL}/DocMgmt/Documents`)).toBe(next)
    expect(() =>
      resolveWindchillNextLink(
        BASE_URL,
        'https://attacker.example.com/steal',
        `${BASE_URL}/DocMgmt/Documents`
      )
    ).toThrow('configured HTTPS origin')
    expect(() =>
      resolveWindchillNextLink(
        BASE_URL,
        `${BASE_URL}/PrincipalMgmt/Users`,
        `${BASE_URL}/DocMgmt/Documents`
      )
    ).toThrow('originating collection')

    expect(() =>
      buildWindchillReadUrl('windchill_list_documents', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        nextLink: `${BASE_URL}/PrincipalMgmt/Users`,
      })
    ).toThrow('originating collection')

    const attachmentNext = `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
      'OR:wt.doc.WTDocument:1'
    )}')/Attachments?%24skiptoken=25`
    expect(
      buildWindchillReadUrl('windchill_list_attachments', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        documentOid: 'OR:wt.doc.WTDocument:1',
        nextLink: attachmentNext,
      })
    ).toBe(attachmentNext)

    const structureNext = `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
      'OR:wt.doc.WTDocument:1'
    )}')/DocUsageLinks?%24skiptoken=25`
    expect(
      buildWindchillReadUrl('windchill_get_document_structure', {
        baseUrl: BASE_URL,
        username: 'user',
        password: 'not-a-real-password',
        documentOid: 'OR:wt.doc.WTDocument:1',
        nextLink: structureNext,
      })
    ).toBe(structureNext)
  })

  it('normalizes documented document fields and pagination', () => {
    expect(
      normalizeWindchillReadOutput('windchill_list_documents', {
        '@odata.count': 2,
        '@odata.nextLink': `${BASE_URL}/DocMgmt/Documents?%24skip=2`,
        value: [
          {
            ID: 'OR:wt.doc.WTDocument:1',
            Name: 'Specification',
            Number: 'DOC-001',
            State: { Value: 'RELEASED', Display: 'Released' },
            VersionID: 'A',
            Version: 'A.2',
            Latest: true,
            UnexpectedProviderField: 'not projected',
          },
          { ID: 'OR:wt.doc.WTDocument:2', Name: 'Drawing' },
        ],
      })
    ).toEqual({
      operation: 'windchill_list_documents',
      documents: [
        {
          id: 'OR:wt.doc.WTDocument:1',
          name: 'Specification',
          number: 'DOC-001',
          title: null,
          description: null,
          state: 'RELEASED',
          stateDisplay: 'Released',
          versionId: 'A',
          revision: null,
          version: 'A.2',
          latest: true,
          checkoutState: null,
          folderName: null,
          folderLocation: null,
        },
        {
          id: 'OR:wt.doc.WTDocument:2',
          name: 'Drawing',
          number: null,
          title: null,
          description: null,
          state: null,
          stateDisplay: null,
          versionId: null,
          revision: null,
          version: null,
          latest: null,
          checkoutState: null,
          folderName: null,
          folderLocation: null,
        },
      ],
      pageInfo: {
        count: 2,
        totalCount: 2,
        nextLink: `${BASE_URL}/DocMgmt/Documents?%24skip=2`,
      },
    })
  })

  it('normalizes structure, lifecycle, and content response shapes', () => {
    expect(
      normalizeWindchillReadOutput('windchill_get_document_structure', {
        '@odata.nextLink': `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
          'OR:wt.doc.WTDocument:1'
        )}')/DocUsageLinks?%24skiptoken=25`,
        value: [
          {
            ID: 'OR:wt.doc.WTDocumentUsageLink:1',
            DocUsedBy: { ID: 'OR:wt.doc.WTDocument:1', Name: 'Parent' },
            DocUses: {
              ID: 'OR:wt.doc.WTDocument:2',
              Name: 'Child',
              DocUsageLinks: [
                {
                  ID: 'OR:wt.doc.WTDocumentUsageLink:2',
                  DocUses: { ID: 'OR:wt.doc.WTDocument:3', Name: 'Grandchild' },
                },
              ],
            },
          },
        ],
      }).structure?.[0]
    ).toMatchObject({
      id: 'OR:wt.doc.WTDocumentUsageLink:1',
      parent: { id: 'OR:wt.doc.WTDocument:1', name: 'Parent' },
      child: { id: 'OR:wt.doc.WTDocument:2', name: 'Child' },
      children: [
        {
          id: 'OR:wt.doc.WTDocumentUsageLink:2',
          parent: { id: 'OR:wt.doc.WTDocument:2', name: 'Child' },
          child: { id: 'OR:wt.doc.WTDocument:3', name: 'Grandchild' },
          children: [],
        },
      ],
    })

    expect(
      normalizeWindchillReadOutput('windchill_get_document_structure', {
        '@odata.nextLink': `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
          'OR:wt.doc.WTDocument:1'
        )}')/DocUsageLinks?%24skiptoken=25`,
        value: [{ ID: 'OR:wt.doc.WTDocumentUsageLink:1' }],
      }).pageInfo
    ).toEqual({
      count: 1,
      totalCount: null,
      nextLink: `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
        'OR:wt.doc.WTDocument:1'
      )}')/DocUsageLinks?%24skiptoken=25`,
    })

    expect(
      normalizeWindchillReadOutput('windchill_get_valid_state_transitions', {
        value: [{ Value: 'RELEASED', Display: 'Released' }],
      }).states
    ).toEqual([{ value: 'RELEASED', display: 'Released' }])

    expect(
      normalizeWindchillReadOutput('windchill_list_attachments', {
        '@odata.count': 2,
        '@odata.nextLink': `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
          'OR:wt.doc.WTDocument:1'
        )}')/Attachments?%24skiptoken=2`,
        value: [
          {
            ID: 'OR:wt.content.ApplicationData:1',
            FileName: 'drawing.pdf',
            MimeType: 'application/pdf',
            FileSize: '42',
          },
          {
            ID: 'OR:wt.content.URLData:2',
            '@odata.type': '#PTC.DocMgmt.URLData',
            DisplayName: 'PTC website',
            UrlLocation: 'https://www.ptc.com',
          },
        ],
      })
    ).toEqual({
      operation: 'windchill_list_attachments',
      attachments: [
        {
          id: 'OR:wt.content.ApplicationData:1',
          fileName: 'drawing.pdf',
          description: null,
          format: null,
          mimeType: 'application/pdf',
          fileSize: 42,
          contentType: null,
          displayName: null,
          urlLocation: null,
          externalLocation: null,
        },
        {
          id: 'OR:wt.content.URLData:2',
          fileName: null,
          description: null,
          format: null,
          mimeType: null,
          fileSize: null,
          contentType: '#PTC.DocMgmt.URLData',
          displayName: 'PTC website',
          urlLocation: 'https://www.ptc.com',
          externalLocation: null,
        },
      ],
      pageInfo: {
        count: 2,
        totalCount: 2,
        nextLink: `${BASE_URL}/DocMgmt/Documents('${encodeURIComponent(
          'OR:wt.doc.WTDocument:1'
        )}')/Attachments?%24skiptoken=2`,
      },
    })
  })

  it('rejects malformed JSON from successful direct reads', async () => {
    await expect(
      transformWindchillDirectRead(
        'windchill_get_document',
        new Response('<html>not json</html>', { status: 200 })
      )
    ).rejects.toThrow('Windchill returned invalid JSON with status 200')
  })

  it('rejects valid JSON that does not match the selected WRS operation', async () => {
    expect(() =>
      normalizeWindchillReadOutput('windchill_list_documents', { unexpected: true })
    ).toThrow('incompatible response')
    expect(() =>
      normalizeWindchillReadOutput('windchill_get_document', { unexpected: true })
    ).toThrow('incompatible response')

    await expect(
      transformWindchillDirectRead(
        'windchill_list_attachments',
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    ).rejects.toThrow('incompatible response')
  })

  it('rejects an internal response for a different operation', async () => {
    await expect(
      transformWindchillInternalResponse(
        'windchill_update_document',
        new Response(
          JSON.stringify({
            success: true,
            output: {
              operation: 'windchill_delete_document',
              affectedIds: ['OR:wt.doc.WTDocument:1'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'Windchill route returned a response for a different operation',
    })
  })

  it('accepts bounded complex attributes but rejects common properties on PATCH updates', () => {
    const common = {
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      operation: 'windchill_update_document' as const,
      documentOid: 'OR:wt.doc.WTDocument:1',
    }
    expect(
      windchillOperationBodySchema.safeParse({
        ...common,
        attributes: {
          DocClassify: { Namespace: 'com.example', Code: 'DRAWING' },
          ClassificationAttributes: [{ Name: 'Region', Value: ['US', 'CA'] }],
        },
      }).success
    ).toBe(true)

    const commonProperty = windchillOperationBodySchema.safeParse({
      ...common,
      attributes: { Name: 'Renamed document' },
    })
    expect(commonProperty.success).toBe(false)
    if (!commonProperty.success) {
      expect(commonProperty.error.issues[0]?.message).toContain('Update Common Properties')
    }

    const viaCommonProperties = windchillOperationBodySchema.safeParse({
      operation: 'windchill_update_common_properties',
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      documentOid: 'OR:wt.doc.WTDocument:1',
      commonProperties: { Name: 'Renamed document', Number: 'DOC-001' },
    })
    expect(viaCommonProperties.success).toBe(true)
  })

  it('represents an explicitly empty primary-content collection as null', () => {
    expect(normalizeWindchillReadOutput('windchill_get_primary_content', { value: [] })).toEqual({
      operation: 'windchill_get_primary_content',
      content: null,
    })
  })

  it('carries the CSRF nonce and session cookie into a mutation', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(
        mockResponse({
          body: { NonceKey: 'CSRF_NONCE', NonceValue: 'nonce-value' },
          cookies: ['JSESSIONID=session-value; Path=/; Secure'],
        })
      )
      .mockResolvedValueOnce(mockResponse({ body: { ID: 'OR:wt.doc.WTDocument:1' } }))

    const params = {
      baseUrl: BASE_URL,
      username: 'windchill-user',
      password: 'not-a-real-password',
    }
    const session = await createWindchillSession(params)
    await windchillMutationRequest({
      params,
      session,
      url: `${BASE_URL}/DocMgmt/Documents`,
      method: 'POST',
      body: { Name: 'Specification' },
    })

    expect(mockSecureFetchWithValidation.mock.calls[0][0]).toBe(
      'https://windchill.example.com/Windchill/servlet/odata/PTC/GetCSRFToken()'
    )
    expect(mockSecureFetchWithValidation.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      maxRedirects: 0,
      headers: {
        Authorization: createBasicAuthHeader('windchill-user', 'not-a-real-password'),
        Cookie: 'JSESSIONID=session-value',
        CSRF_NONCE: 'nonce-value',
        'Content-Type': 'application/json',
      },
    })
  })

  it('uploads content in three stages without sending credentials to ReplicaUrl', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(
        mockResponse({ body: { NonceKey: 'CSRF_NONCE', NonceValue: 'nonce-value' } })
      )
      .mockResolvedValueOnce(
        mockResponse({
          body: {
            value: [
              {
                ReplicaUrl: 'https://replica.example.com/upload/signed',
                MasterUrl: 'https://windchill.example.com/master',
                StreamIds: ['stream-1'],
                FileNames: ['specification.pdf'],
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          body: {
            contentInfos: [{ streamId: 'stream-1', fileSize: 3, encodedInfo: 'encoded-info' }],
          },
        })
      )
      .mockResolvedValueOnce(mockResponse({ body: {} }))

    const names = await uploadWindchillContent({
      params: {
        baseUrl: BASE_URL,
        username: 'windchill-user',
        password: 'not-a-real-password',
      },
      documentOid: 'OR:wt.doc.WTDocument:1',
      files: [
        {
          name: 'specification.pdf',
          mimeType: 'application/pdf',
          size: 3,
          buffer: Buffer.from('pdf'),
        },
      ],
      primaryContent: true,
    })

    expect(names).toEqual(['specification.pdf'])
    expect(mockSecureFetchWithValidation).toHaveBeenCalledTimes(4)
    expect(mockSecureFetchWithValidation.mock.calls[1][0]).toContain(
      '/PTC.DocMgmt.UploadStage1Action'
    )
    expect(JSON.parse(mockSecureFetchWithValidation.mock.calls[1][1].body)).toEqual({
      NoOfFiles: 1,
    })
    expect(mockSecureFetchWithValidation.mock.calls[2][0]).toBe(
      'https://replica.example.com/upload/signed'
    )
    expect(mockSecureFetchWithValidation.mock.calls[2][1].headers.Authorization).toBeUndefined()
    expect(mockSecureFetchWithValidation.mock.calls[2][1].headers.Cookie).toBeUndefined()
    expect(mockSecureFetchWithValidation.mock.calls[2][2]).toBe('ReplicaUrl')
    expect(mockSecureFetchWithValidation.mock.calls[3][0]).toContain(
      '/PTC.DocMgmt.UploadStage3Action'
    )
    expect(JSON.parse(mockSecureFetchWithValidation.mock.calls[3][1].body)).toEqual({
      ContentInfo: [
        {
          StreamId: 'stream-1',
          EncodedInfo: 'encoded-info',
          FileName: 'specification.pdf',
          PrimaryContent: true,
          MimeType: 'application/pdf',
          FileSize: 3,
        },
      ],
    })
  })

  it('resolves content bytes through the documented typed Content/URL navigation', async () => {
    mockSecureFetchWithValidation.mockResolvedValueOnce(
      mockResponse({
        body: {
          '@odata.context': `${BASE_URL}/PTC/$metadata#ContentItems/Content/URL`,
          value:
            'https://windchill.example.com/Windchill/servlet/WindchillGW/wt.fv.master.StandardMasterService/doDirectDownload/spec.pdf?sign=abc',
        },
      })
    )

    const url = await resolveWindchillContentUrl({
      params: { baseUrl: BASE_URL, username: 'windchill-user', password: 'not-a-real-password' },
      contentPath: `${BASE_URL}/DocMgmt/Documents('OR%3Awt.doc.WTDocument%3A1')/PrimaryContent`,
    })

    expect(mockSecureFetchWithValidation.mock.calls[0][0]).toBe(
      `${BASE_URL}/DocMgmt/Documents('OR%3Awt.doc.WTDocument%3A1')/PrimaryContent/PTC.ApplicationData/Content/URL`
    )
    expect(url).toContain('/WindchillGW/wt.fv.master.StandardMasterService/doDirectDownload/')
  })

  it('refuses a content download URL that leaves the configured origin', async () => {
    mockSecureFetchWithValidation.mockResolvedValueOnce(
      mockResponse({ body: { value: 'https://attacker.example.com/steal' } })
    )

    await expect(
      resolveWindchillContentUrl({
        params: { baseUrl: BASE_URL, username: 'windchill-user', password: 'not-a-real-password' },
        contentPath: `${BASE_URL}/DocMgmt/Documents('OR%3Awt.doc.WTDocument%3A1')/PrimaryContent`,
      })
    ).rejects.toThrow('must remain on the configured HTTPS origin')
  })

  it('terminates every Stage 2 cache descriptor with a semicolon', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(
        mockResponse({ body: { NonceKey: 'CSRF_NONCE', NonceValue: 'nonce-value' } })
      )
      .mockResolvedValueOnce(
        mockResponse({
          body: {
            value: [
              {
                ReplicaUrl: 'https://replica.example.com/upload/signed',
                MasterUrl: 'https://windchill.example.com/master',
                StreamIds: [76030, 76031],
                FileNames: [76030, 76031],
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          body: {
            contentInfos: [
              { streamId: 76030, fileSize: 3, encodedInfo: 'encoded-1' },
              { streamId: 76031, fileSize: 5, encodedInfo: 'encoded-2' },
            ],
          },
        })
      )
      .mockResolvedValueOnce(mockResponse({ body: {} }))

    await uploadWindchillContent({
      params: { baseUrl: BASE_URL, username: 'windchill-user', password: 'not-a-real-password' },
      documentOid: 'OR:wt.doc.WTDocument:1',
      files: [
        { name: 'first.txt', mimeType: 'text/plain', size: 3, buffer: Buffer.from('abc') },
        { name: 'second.txt', mimeType: 'text/plain', size: 5, buffer: Buffer.from('abcde') },
      ],
      primaryContent: false,
    })

    const stageTwoBody: string =
      mockSecureFetchWithValidation.mock.calls[2][1].body.toString('utf8')
    const descriptor = stageTwoBody
      .split('name="CacheDescriptor_array"')[1]
      .split('--')[0]
      .replace(/\r?\n/g, '')
      .trim()
    expect(descriptor).toBe('76030:76030:76030:3; 76031:76031:76031:5;')
  })

  it('rejects malformed JSON from successful mutation responses', async () => {
    mockSecureFetchWithValidation
      .mockResolvedValueOnce(
        mockResponse({ body: { NonceKey: 'CSRF_NONCE', NonceValue: 'nonce-value' } })
      )
      .mockResolvedValueOnce(mockResponse({ rawBody: '<html>not json</html>' }))

    const params = {
      baseUrl: BASE_URL,
      username: 'windchill-user',
      password: 'not-a-real-password',
    }
    const session = await createWindchillSession(params)

    await expect(
      windchillMutationRequest({
        params,
        session,
        url: `${BASE_URL}/DocMgmt/Documents`,
        method: 'POST',
        body: { Name: 'Specification' },
      })
    ).rejects.toThrow('Windchill returned invalid JSON with status 200')
  })

  it('preserves diagnostic URL paths while redacting query secrets and credentials', () => {
    expect(
      sanitizeWindchillError(
        'POST https://replica.example.com/signed?token=secret CSRF_NONCE=nonce Basic dXNlcjpwYXNz'
      )
    ).toBe('POST https://replica.example.com/signed [redacted nonce] Basic [redacted]')
  })
})

describe('Windchill block', () => {
  it('selects only registered operation IDs and defaults to list documents', () => {
    const operation = WindchillBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    expect(operation?.value?.({})).toBe('windchill_list_documents')
    expect(operation?.options?.map((option) => option.id)).toEqual([...WINDCHILL_OPERATIONS])
    expect(WindchillBlock.tools.access).toEqual([...WINDCHILL_OPERATIONS])

    for (const toolId of WINDCHILL_OPERATIONS) {
      expect(WindchillBlock.tools.config?.tool({ operation: toolId })).toBe(toolId)
    }

    expect(WindchillBlock.subBlocks.some((subBlock) => subBlock.id === 'expand')).toBe(false)
    expect(WindchillBlock.inputs).not.toHaveProperty('expand')
    expect(WINDCHILL_TOOLS_BY_ID.get('windchill_update_document')?.params.attributes.required).toBe(
      true
    )
    for (const operation of [
      'windchill_list_documents',
      'windchill_get_document_structure',
      'windchill_list_attachments',
    ]) {
      expect(WINDCHILL_TOOLS_BY_ID.get(operation)?.outputs).toHaveProperty('pageInfo')
    }
    expect(WINDCHILL_TOOLS_BY_ID.get('windchill_get_document')?.outputs).toHaveProperty(
      'document.properties.stateDisplay'
    )
  })

  it('uses one canonical parameter for each basic and advanced file pair', () => {
    const primaryFiles = WindchillBlock.subBlocks.filter(
      (subBlock) => subBlock.canonicalParamId === 'primaryFile'
    )
    const attachmentFiles = WindchillBlock.subBlocks.filter(
      (subBlock) => subBlock.canonicalParamId === 'attachmentFiles'
    )

    expect(primaryFiles.map((subBlock) => subBlock.mode)).toEqual(['basic', 'advanced'])
    expect(attachmentFiles.map((subBlock) => subBlock.mode)).toEqual(['basic', 'advanced'])
    expect(WindchillBlock.inputs.primaryFile.type).toBe('file')
    expect(WindchillBlock.inputs.attachmentFiles.type).toBe('array')
  })

  it('exposes only outputs produced by the selected operation', () => {
    expect(WindchillBlock.outputs.file.condition).toEqual({
      field: 'operation',
      value: ['windchill_download_primary_content', 'windchill_download_attachment'],
    })
    expect(WindchillBlock.outputs.pageInfo.condition).toEqual({
      field: 'operation',
      value: [
        'windchill_list_documents',
        'windchill_get_document_structure',
        'windchill_list_attachments',
      ],
    })
    expect(WindchillBlock.outputs.uploadedFileNames.condition).toEqual({
      field: 'operation',
      value: ['windchill_upload_primary_content', 'windchill_upload_attachments'],
    })
  })

  it('coerces execution values and parses JSON without changing tool selection', () => {
    const params = WindchillBlock.tools.config?.params?.({
      operation: 'windchill_list_documents',
      baseUrl: BASE_URL,
      username: 'user',
      password: 'not-a-real-password',
      top: '25',
      skip: '10',
      count: 'true',
      latestVersion: false,
      documentOids: '["OR:wt.doc.WTDocument:1"]',
      attributes: '{"Title":"Updated"}',
    })

    expect(params).toMatchObject({
      baseUrl: BASE_URL,
      top: 25,
      skip: 10,
      count: true,
      latestVersion: false,
      documentOids: ['OR:wt.doc.WTDocument:1'],
      attributes: { Title: 'Updated' },
    })
    expect(params).not.toHaveProperty('operation')
  })

  it('publishes document-management metadata with concrete templates', () => {
    expect(WindchillBlock.integrationType).toBe('documents')
    expect(WindchillBlockMeta.tags).toEqual(['content-management', 'document-processing'])
    expect(WindchillBlockMeta.templates).toHaveLength(7)
    expect(WindchillBlockMeta.skills).toHaveLength(7)
    expect(new Set(WindchillBlockMeta.skills.map((skill) => skill.name)).size).toBe(7)
  })
})
