/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ MicrosoftSharepointIcon: () => null }))

import {
  normalizeSegment,
  resolveFolderTarget,
  serverRelativePathFromUrl,
} from '@/connectors/sharepoint/sharepoint'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const SITE_ID = 'contoso.sharepoint.com,site-guid,web-guid'
const SITE_URL = 'contoso.sharepoint.com'
const DEFAULT_DRIVE_ID = 'b!default'
const POLICIES_DRIVE_ID = 'b!policies'

interface GraphRoute {
  status?: number
  body?: unknown
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
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body ?? {}),
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

  it('surfaces a failure to open the default library rather than reporting not-found', async () => {
    mockGraph({
      [`${GRAPH}/sites/${SITE_ID}/drive?$select=id,name,webUrl`]: { status: 403 },
    })

    await expect(resolve('00 IWW Library')).rejects.toThrow(
      /Failed to open the default document library/
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
