/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  readBoundedHttpErrorBody: async (response: Response) => response.text(),
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ MicrosoftSharepointIcon: () => null }))

import {
  normalizeSegment,
  resolveFolderTarget,
  serverRelativePathFromUrl,
  sharepointConnector,
} from '@/connectors/sharepoint/sharepoint'
import {
  appendPendingMicrosoftGraphFolders,
  encodeMicrosoftGraphTraversalCursor,
  MICROSOFT_GRAPH_MAX_PENDING_FOLDERS,
} from '@/connectors/utils'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const SITE_ID = 'contoso.sharepoint.com,site-guid,web-guid'
const SITE_URL = 'contoso.sharepoint.com'
const DEFAULT_DRIVE_ID = 'b!default'
const POLICIES_DRIVE_ID = 'b!policies'

interface GraphRoute {
  status?: number
  body?: unknown
  /** Serve `body` as bytes, for the `/content` endpoint the downloader reads. */
  raw?: boolean
}

/** Folder-shaped drive item for children listings. */
function folder(id: string, name: string) {
  return { id, name, folder: { childCount: 0 } }
}

/**
 * Installs a URL-keyed fake Graph. Any URL without a route replies 404, which is
 * what makes the "falls through to the next layer" assertions meaningful.
 */
function mockGraph(routes: Record<string, GraphRoute>) {
  const requested: string[] = []
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    requested.push(url)
    const route = routes[url] ?? { status: 404 }
    const status = route.status ?? 200
    const responseBytes = Buffer.from(
      route.raw ? String(route.body ?? '') : JSON.stringify(route.body ?? {})
    )
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-length': String(responseBytes.byteLength) }),
      json: async () => route.body,
      text: async () => JSON.stringify(route.body ?? {}),
      /** `readBodyWithLimit` falls back to this when there is no stream body. */
      arrayBuffer: async () => responseBytes,
    } as unknown as Response
  })
  return requested
}

const defaultDriveRoute = {
  [`${GRAPH}/sites/${SITE_ID}/drive?$select=id,name,webUrl`]: {
    body: {
      id: DEFAULT_DRIVE_ID,
      name: 'Documents',
      webUrl: 'https://contoso.sharepoint.com/Shared%20Documents',
    },
  },
}

const sitesDrivesRoute = {
  [`${GRAPH}/sites/${SITE_ID}/drives?$select=id,name,webUrl`]: {
    body: {
      value: [
        {
          id: DEFAULT_DRIVE_ID,
          name: 'Documents',
          webUrl: 'https://contoso.sharepoint.com/Shared%20Documents',
        },
        {
          id: POLICIES_DRIVE_ID,
          name: 'Policies',
          webUrl: 'https://contoso.sharepoint.com/Policies',
        },
      ],
    },
  },
}

function rootChildren(driveId: string, items: unknown[]) {
  return {
    [`${GRAPH}/drives/${driveId}/root/children?$top=200&$select=id,name,folder`]: {
      body: { value: items },
    },
  }
}

/** Builds a Graph pagination chain with an optional continuation beyond the final allowed page. */
function paginatedRoutes(
  initialUrl: string,
  routePrefix: string,
  pageCount: number,
  continueAfterLast: boolean
): Record<string, GraphRoute> {
  const routes: Record<string, GraphRoute> = {}

  for (let page = 0; page < pageCount; page++) {
    const url = page === 0 ? initialUrl : `${GRAPH}/${routePrefix}/${page}`
    const hasNextPage = page < pageCount - 1 || continueAfterLast
    routes[url] = {
      body: {
        value: [],
        ...(hasNextPage ? { '@odata.nextLink': `${GRAPH}/${routePrefix}/${page + 1}` } : {}),
      },
    }
  }

  return routes
}

function resolve(folderPath?: string) {
  return resolveFolderTarget('token', SITE_ID, SITE_URL, 'Contoso', folderPath)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveFolderTarget', () => {
  it('returns the default library root when no folder path is configured', async () => {
    const requested = mockGraph({ ...defaultDriveRoute })

    await expect(resolve(undefined)).resolves.toEqual({
      driveId: DEFAULT_DRIVE_ID,
      driveName: 'Documents',
    })
    expect(requested.some((url) => url.includes('root:'))).toBe(false)
  })

  it('resolves a top-level folder by exact path against the default library', async () => {
    const requested = mockGraph({
      ...defaultDriveRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library`]: {
        body: folder('folder-1', '00 IWW Library'),
      },
    })

    await expect(resolve('00 IWW Library')).resolves.toEqual({
      driveId: DEFAULT_DRIVE_ID,
      driveName: 'Documents',
      folderId: 'folder-1',
    })
    expect(requested).toContain(`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library`)
  })

  it('ignores leading and trailing slashes', async () => {
    mockGraph({
      ...defaultDriveRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library`]: {
        body: folder('folder-1', '00 IWW Library'),
      },
    })

    await expect(resolve('/00 IWW Library/')).resolves.toMatchObject({ folderId: 'folder-1' })
  })

  it('resolves a nested folder', async () => {
    mockGraph({
      ...defaultDriveRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library/Templates`]: {
        body: folder('folder-2', 'Templates'),
      },
    })

    await expect(resolve('00 IWW Library/Templates')).resolves.toMatchObject({
      folderId: 'folder-2',
    })
  })

  it('strips a leading document-library name that is not a real folder', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library`]: {
        body: folder('folder-1', '00 IWW Library'),
      },
    })

    await expect(resolve('Shared Documents/00 IWW Library')).resolves.toEqual({
      driveId: DEFAULT_DRIVE_ID,
      driveName: 'Documents',
      folderId: 'folder-1',
    })
  })

  it('prefers a real folder named "Documents" over the library-name interpretation', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/Documents/Reports`]: {
        body: folder('real-nested', 'Reports'),
      },
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/Reports`]: {
        body: folder('wrong-one', 'Reports'),
      },
    })

    await expect(resolve('Documents/Reports')).resolves.toMatchObject({
      folderId: 'real-nested',
    })
  })

  it('resolves a folder in a non-default document library', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      [`${GRAPH}/drives/${POLICIES_DRIVE_ID}/root:/HR`]: { body: folder('hr-1', 'HR') },
    })

    await expect(resolve('Policies/HR')).resolves.toEqual({
      driveId: POLICIES_DRIVE_ID,
      driveName: 'Policies',
      folderId: 'hr-1',
    })
  })

  it('resolves a bare non-default library name to that library root', async () => {
    mockGraph({ ...defaultDriveRoute, ...sitesDrivesRoute })

    await expect(resolve('Policies')).resolves.toEqual({
      driveId: POLICIES_DRIVE_ID,
      driveName: 'Policies',
    })
  })

  it('recovers a folder whose real name contains a non-breaking space', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [
        folder('other', 'Archive'),
        folder('folder-1', '00\u00a0IWW Library'),
      ]),
    })

    await expect(resolve('00 IWW Library')).resolves.toMatchObject({ folderId: 'folder-1' })
  })

  it('recovers a folder that differs only by case', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [folder('folder-1', '00 iww library')]),
    })

    await expect(resolve('00 IWW LIBRARY')).resolves.toMatchObject({ folderId: 'folder-1' })
  })

  it('refuses to guess when two sibling folders normalize identically', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [
        folder('a', '00 IWW Library'),
        folder('b', '00\u00a0IWW  Library'),
      ]),
    })

    await expect(resolve('00 IWW Library')).rejects.toThrow(/matches more than one folder/)
  })

  it('rejects a path that resolves to a file', async () => {
    mockGraph({
      ...defaultDriveRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/notes.txt`]: {
        body: { id: 'f1', name: 'notes.txt', file: { mimeType: 'text/plain' } },
      },
    })

    await expect(resolve('notes.txt')).rejects.toThrow(/is not a folder/)
  })

  it('reports the site, library, path and existing folders when nothing matches', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [folder('a', 'Archive'), folder('b', 'Reports')]),
    })

    await expect(resolve('00 IWW Library')).rejects.toThrow(
      /Folder not found: "00 IWW Library"[\s\S]*Contoso[\s\S]*Documents[\s\S]*"Archive", "Reports"/
    )
  })

  it('blames the matched library, not the default one, when its remainder is wrong', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [folder('d1', 'Archive')]),
      ...rootChildren(POLICIES_DRIVE_ID, [folder('p1', 'Onboarding')]),
    })

    const error = await resolve('Policies/HR').catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('document library "Policies"')
    expect(message).toContain('"HR"')
    expect(message).toContain('"Onboarding"')
    expect(message).not.toContain('document library "Documents"')
    expect(message).not.toContain('Shared Documents" should be omitted')
  })

  it('still offers the prefix hint when the path names the default library itself', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...rootChildren(DEFAULT_DRIVE_ID, [folder('d1', 'Archive')]),
    })

    const error = await resolve('Shared Documents/Reports').catch((e: Error) => e)

    const message = (error as Error).message
    expect(message).toContain('document library "Documents"')
    expect(message).toContain('Shared Documents" should be omitted')
  })

  it('surfaces a failure to open the default library rather than reporting not-found', async () => {
    mockGraph({
      [`${GRAPH}/sites/${SITE_ID}/drive?$select=id,name,webUrl`]: { status: 403 },
    })

    await expect(resolve('00 IWW Library')).rejects.toThrow(
      /Failed to open the default document library/
    )
  })

  it('surfaces a terminal document-library listing failure', async () => {
    mockGraph({
      ...defaultDriveRoute,
      [`${GRAPH}/sites/${SITE_ID}/drives?$select=id,name,webUrl`]: {
        status: 503,
        body: { error: { message: 'Service unavailable' } },
      },
    })

    await expect(resolve('Missing')).rejects.toThrow(
      /Failed to list SharePoint document libraries: 503/
    )
  })

  it('rejects a document-library listing that continues beyond its safety limit', async () => {
    const initialUrl = `${GRAPH}/sites/${SITE_ID}/drives?$select=id,name,webUrl`
    mockGraph({
      ...defaultDriveRoute,
      ...paginatedRoutes(initialUrl, 'drive-pages', 20, true),
    })

    await expect(resolve('Missing')).rejects.toThrow(
      /document-library listing exceeded the 20-page safety limit/
    )
  })

  it('surfaces a 404 encountered while traversing a folder collection', async () => {
    mockGraph({ ...defaultDriveRoute, ...sitesDrivesRoute })

    await expect(resolve('Missing')).rejects.toThrow(/Failed to list folder contents: 404/)
  })

  it('rejects a folder listing that continues beyond its safety limit', async () => {
    const initialUrl = `${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root/children?$top=200&$select=id,name,folder`
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      ...paginatedRoutes(initialUrl, 'folder-pages', 50, true),
    })

    await expect(resolve('Missing')).rejects.toThrow(
      /folder listing exceeded the 50-page safety limit/
    )
  })

  it('accepts an address-bar folder URL carrying the path in the id parameter', async () => {
    mockGraph({
      ...defaultDriveRoute,
      ...sitesDrivesRoute,
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/root:/00%20IWW%20Library`]: {
        body: folder('folder-1', '00 IWW Library'),
      },
    })

    const url =
      'https://contoso.sharepoint.com/Shared%20Documents/Forms/AllItems.aspx' +
      '?id=%2FShared%20Documents%2F00%20IWW%20Library&viewid=abc'

    await expect(resolve(url)).resolves.toMatchObject({ folderId: 'folder-1' })
  })

  it('rejects a tokenized sharing link with actionable guidance', async () => {
    mockGraph({ ...defaultDriveRoute })

    await expect(resolve('https://contoso.sharepoint.com/:f:/s/hr/Ei4xAbC?e=xyz')).rejects.toThrow(
      /address bar/
    )
  })
})

const ITEM_SELECT =
  'id,name,webUrl,size,file,folder,package,remoteItem,lastModifiedDateTime,createdDateTime,createdBy,parentReference'

/** File-shaped drive item for children listings. */
function file(id: string, name: string) {
  return {
    id,
    name,
    size: 10,
    file: { mimeType: 'text/plain' },
    lastModifiedDateTime: '2026-01-01T00:00:00Z',
  }
}

function childrenRoute(driveId: string, folderId: string | null, items: unknown[]) {
  const base = folderId
    ? `${GRAPH}/drives/${driveId}/items/${folderId}/children`
    : `${GRAPH}/drives/${driveId}/root/children`
  return { [`${base}?$top=200&$select=${ITEM_SELECT}`]: { body: { value: items } } }
}

/** Pre-resolved context, so listDocuments goes straight to the children walk. */
function listContext() {
  return { siteId: SITE_ID, siteName: 'Contoso', driveId: DEFAULT_DRIVE_ID }
}

function list(maxFiles: string | undefined, syncContext: Record<string, unknown>) {
  return sharepointConnector.listDocuments(
    'token',
    { siteUrl: SITE_URL, maxFiles },
    undefined,
    syncContext
  )
}

describe('listDocuments', () => {
  it('flags the listing capped when the cap hides items inside the final page', async () => {
    mockGraph(
      childrenRoute(DEFAULT_DRIVE_ID, null, [
        file('f1', 'a.txt'),
        file('f2', 'b.txt'),
        file('f3', 'c.txt'),
      ])
    )
    const syncContext = listContext()

    const result = await list('2', syncContext)

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('does not flag the listing capped when the cap lands on the last item', async () => {
    mockGraph(childrenRoute(DEFAULT_DRIVE_ID, null, [file('f1', 'a.txt'), file('f2', 'b.txt')]))
    const syncContext = listContext()

    const result = await list('2', syncContext)

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('drains subfolders within a single call instead of one folder per page', async () => {
    mockGraph({
      ...childrenRoute(DEFAULT_DRIVE_ID, null, [file('f1', 'a.txt'), folder('sub', 'Sub')]),
      ...childrenRoute(DEFAULT_DRIVE_ID, 'sub', [file('f2', 'b.txt')]),
    })
    const syncContext = listContext()

    const result = await list(undefined, syncContext)

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['f1', 'f2'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('does not retain irrelevant folders after maxFiles has stopped traversal', async () => {
    mockGraph(
      childrenRoute(DEFAULT_DRIVE_ID, null, [file('f1', 'a.txt'), folder('overflow', 'Overflow')])
    )
    const cursor = encodeMicrosoftGraphTraversalCursor(
      {
        folderStack: Array.from(
          { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS },
          (_, index) => `pending-${index}`
        ),
      },
      'SharePoint'
    )
    const syncContext = listContext()

    const result = await sharepointConnector.listDocuments(
      'token',
      { siteUrl: SITE_URL, maxFiles: '1' },
      cursor,
      syncContext
    )

    expect(result.documents.map((document) => document.externalId)).toEqual(['f1'])
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  /**
   * The reported failure: a document library of Office SOPs synced as
   * "success, 0 documents" because the listing filter accepted only plain text,
   * which is indistinguishable from a wrong folder path.
   */
  it('lists Office documents and PDFs alongside text files', async () => {
    mockGraph(
      childrenRoute(DEFAULT_DRIVE_ID, null, [
        file('f1', 'Market Data SOP.docx'),
        file('f2', 'Vendor Contract.pdf'),
        file('f3', 'User List.xlsx'),
        file('f4', 'Overview.pptx'),
        file('f5', 'notes.txt'),
      ])
    )

    const result = await list(undefined, listContext())

    expect(result.documents.map((doc) => doc.title)).toEqual([
      'Market Data SOP.docx',
      'Vendor Contract.pdf',
      'User List.xlsx',
      'Overview.pptx',
      'notes.txt',
    ])
  })

  it('still excludes files with no extractable text', async () => {
    mockGraph(
      childrenRoute(DEFAULT_DRIVE_ID, null, [
        file('f1', 'diagram.png'),
        file('f2', 'recording.mp4'),
        file('f3', 'notes.txt'),
      ])
    )

    const result = await list(undefined, listContext())

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['f3'])
  })

  it('builds a metadata-only contentHash that getDocument can reproduce', async () => {
    mockGraph(childrenRoute(DEFAULT_DRIVE_ID, null, [file('f1', 'a.txt')]))

    const result = await list(undefined, listContext())

    expect(result.documents[0].contentHash).toBe('sharepoint:f1:2026-01-01T00:00:00Z')
    expect(result.documents[0].contentDeferred).toBe(true)
  })

  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxFiles %s before calling Graph',
    async (maxFiles) => {
      const requested = mockGraph({})

      await expect(
        sharepointConnector.listDocuments(
          'token',
          { siteUrl: SITE_URL, maxFiles },
          undefined,
          listContext()
        )
      ).rejects.toThrow(/positive safe integer/)
      expect(requested).toHaveLength(0)
    }
  )
})

describe('validateConfig', () => {
  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxFiles %s without calling Graph',
    async (maxFiles) => {
      const requested = mockGraph({})

      await expect(
        sharepointConnector.validateConfig!('token', { siteUrl: SITE_URL, maxFiles })
      ).resolves.toEqual({
        valid: false,
        error: 'Max files must be a positive safe integer, or 0 for unlimited',
      })
      expect(requested).toHaveLength(0)
    }
  )

  it('accepts a valid integer maxFiles', async () => {
    const siteRoute = `${GRAPH}/sites/${SITE_URL}`
    const requested = mockGraph({
      [siteRoute]: { body: { id: SITE_ID, displayName: 'Contoso' } },
      ...defaultDriveRoute,
    })

    await expect(
      sharepointConnector.validateConfig!('token', { siteUrl: SITE_URL, maxFiles: '25' })
    ).resolves.toEqual({ valid: true })
    expect(requested).toEqual([siteRoute, Object.keys(defaultDriveRoute)[0]])
  })
})

describe('SharePoint traversal working-set bound', () => {
  it('accepts discovered folders up to the pending-folder ceiling', () => {
    const pending = Array.from(
      { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS - 2 },
      (_, index) => `pending-${index}`
    )

    appendPendingMicrosoftGraphFolders(pending, ['last-1', 'last-2'], 'SharePoint')

    expect(pending).toHaveLength(MICROSOFT_GRAPH_MAX_PENDING_FOLDERS)
  })

  it('stops before retaining a folder page beyond the ceiling', () => {
    const pending = Array.from(
      { length: MICROSOFT_GRAPH_MAX_PENDING_FOLDERS },
      (_, index) => `pending-${index}`
    )

    expect(() => appendPendingMicrosoftGraphFolders(pending, ['overflow'], 'SharePoint')).toThrow(
      /Narrow the connector/
    )
    expect(pending).toHaveLength(MICROSOFT_GRAPH_MAX_PENDING_FOLDERS)
  })
})

describe('getDocument content extraction', () => {
  function itemRoute(itemId: string, name: string) {
    return {
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/items/${itemId}?$select=${ITEM_SELECT}`]: {
        body: file(itemId, name),
      },
    }
  }

  /** The content endpoint is fetched directly, not through the JSON `graphGet`. */
  function contentRoute(itemId: string, body: string) {
    return {
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/items/${itemId}/content`]: { body, raw: true },
    }
  }

  function get(externalId: string) {
    return sharepointConnector.getDocument!(
      'token',
      { siteUrl: SITE_URL },
      externalId,
      listContext()
    )
  }

  it.each([{}, { id: 'f1', name: 'Missing facet' }, file('different', 'a.txt')])(
    'rejects malformed metadata instead of replacing retained content',
    async (metadata) => {
      mockGraph({
        [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/items/f1?$select=${ITEM_SELECT}`]: {
          body: metadata,
        },
      })

      await expect(get('f1')).rejects.toThrow(
        'Microsoft Graph returned malformed SharePoint item metadata'
      )
    }
  )

  /**
   * The connector hands an Office document over untouched so the shared pipeline
   * parses it — the same path an upload of the same file takes, which is what
   * routes PDFs through OCR.
   */
  it('delivers an Office document as its source file rather than extracting it', async () => {
    mockGraph({ ...itemRoute('f1', 'SOP.docx'), ...contentRoute('f1', 'PK-docx-bytes') })

    const doc = await get('f1')

    expect(doc?.content).toBe('')
    expect(doc?.sourceFile?.fileName).toBe('SOP.docx')
    expect(doc?.sourceFile?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(doc?.sourceFile?.bytes.toString()).toBe('PK-docx-bytes')
    expect(doc?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(doc?.contentDeferred).toBe(false)
  })

  it('declares a PDF as application/pdf so the pipeline can route it to OCR', async () => {
    mockGraph({ ...itemRoute('f4', 'Contract.pdf'), ...contentRoute('f4', '%PDF-1.7 bytes') })

    const doc = await get('f4')

    expect(doc?.mimeType).toBe('application/pdf')
    expect(doc?.sourceFile?.mimeType).toBe('application/pdf')
  })

  it('still extracts a text file itself, since there is nothing for a parser to do', async () => {
    mockGraph({ ...itemRoute('f3', 'notes.txt'), ...contentRoute('f3', 'plain notes') })

    const doc = await get('f3')

    expect(doc?.content).toBe('plain notes')
    expect(doc?.sourceFile).toBeUndefined()
    expect(doc?.mimeType).toBe('text/plain')
  })

  it('authoritatively skips a listed file that changed to a folder', async () => {
    mockGraph({
      [`${GRAPH}/drives/${DEFAULT_DRIVE_ID}/items/folder?$select=${ITEM_SELECT}`]: {
        body: folder('folder', 'Former document'),
      },
    })

    await expect(get('folder')).resolves.toMatchObject({
      content: '',
      skippedReason: 'File is no longer an indexable document',
      skippedExistingDisposition: 'replace',
    })
  })

  it('marks an empty file as an authoritative skip', async () => {
    const item = file('empty', 'empty.txt')
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.endsWith('/content')) return new Response(new Uint8Array(0))
      return new Response(JSON.stringify(item), {
        headers: { 'content-type': 'application/json' },
      })
    })

    const document = await get('empty')

    expect(document).toMatchObject({
      externalId: 'empty',
      content: '',
      contentDeferred: false,
      skippedReason: 'Document contains no extractable text',
      skippedExistingDisposition: 'replace',
    })
  })
})

describe('serverRelativePathFromUrl', () => {
  it('strips the site prefix from a site-scoped URL', () => {
    expect(
      serverRelativePathFromUrl(
        'https://contoso.sharepoint.com/sites/hr/Shared%20Documents/Reports',
        'contoso.sharepoint.com/sites/hr'
      )
    ).toEqual(['Shared Documents', 'Reports'])
  })

  it('drops the Forms view suffix', () => {
    expect(
      serverRelativePathFromUrl(
        'https://contoso.sharepoint.com/Shared%20Documents/Forms/AllItems.aspx',
        'contoso.sharepoint.com'
      )
    ).toEqual(['Shared Documents'])
  })

  it('returns null for a tokenized sharing link', () => {
    expect(
      serverRelativePathFromUrl(
        'https://contoso.sharepoint.com/:f:/s/hr/Ei4xAbC',
        'contoso.sharepoint.com'
      )
    ).toBeNull()
  })
})

describe('normalizeSegment', () => {
  it('folds non-breaking spaces, repeated whitespace and case', () => {
    expect(normalizeSegment('00\u00a0IWW  LIBRARY ')).toBe('00 iww library')
  })

  it('removes zero-width characters', () => {
    expect(normalizeSegment('Report\u200bs')).toBe('reports')
  })

  it('leaves an ordinary name unchanged apart from case', () => {
    expect(normalizeSegment('Reports')).toBe('reports')
  })
})
