/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindchillBlock, WindchillBlockMeta } from '@/blocks/blocks/windchill'
import type { ToolConfig } from '@/tools/types'
import * as windchillTools from '@/tools/windchill'
import {
  WINDCHILL_OPERATIONS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillReadUrl,
  createBasicAuthHeader,
  encodeWindchillOid,
  normalizeServiceRoot,
  normalizeWindchillReadOutput,
  resolveWindchillNextLink,
  sanitizeWindchillError,
  transformWindchillDirectRead,
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
  uploadWindchillContent,
  windchillMutationRequest,
} from '@/tools/windchill/utils.server'

const BASE_URL = 'https://windchill.example.com/Windchill/servlet/odata/v6'

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

    for (const operation of WINDCHILL_OPERATIONS) {
      const tool = WINDCHILL_TOOLS_BY_ID.get(operation)
      expect(tool).toBeDefined()
      if (!tool) continue

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
        top: 201,
      })
    ).toThrow('top must be an integer between 1 and 200')
  })

  it('accepts only same-origin next links under the configured service root', () => {
    const next = `${BASE_URL}/DocMgmt/Documents?%24skip=100`
    expect(resolveWindchillNextLink(BASE_URL, next)).toBe(next)
    expect(() => resolveWindchillNextLink(BASE_URL, 'https://attacker.example.com/steal')).toThrow(
      'configured HTTPS origin'
    )
    expect(() =>
      resolveWindchillNextLink(BASE_URL, 'https://windchill.example.com/unrelated')
    ).toThrow('configured service root')

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
        '@odata.nextLink': `${BASE_URL}/DocMgmt/DocUsageLinks?%24skiptoken=25`,
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
        '@odata.nextLink': `${BASE_URL}/DocMgmt/DocUsageLinks?%24skiptoken=25`,
        value: [{ ID: 'OR:wt.doc.WTDocumentUsageLink:1' }],
      }).pageInfo
    ).toEqual({
      count: 1,
      totalCount: null,
      nextLink: `${BASE_URL}/DocMgmt/DocUsageLinks?%24skiptoken=25`,
    })

    expect(
      normalizeWindchillReadOutput('windchill_get_valid_state_transitions', {
        value: [{ Value: 'RELEASED', Display: 'Released' }],
      }).states
    ).toEqual([{ value: 'RELEASED', display: 'Released' }])

    expect(
      normalizeWindchillReadOutput('windchill_list_attachments', {
        '@odata.count': 2,
        '@odata.nextLink': `${BASE_URL}/DocMgmt/Attachments?%24skiptoken=2`,
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
        nextLink: `${BASE_URL}/DocMgmt/Attachments?%24skiptoken=2`,
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
    expect(WindchillBlockMeta.skills).toHaveLength(5)
  })
})
