import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_SOURCES,
  type BrowserSource,
  userDataDirFor,
} from '@/main/browser-import/browser-sources'
import {
  listAllBrowserProfiles,
  listBrowserProfiles,
} from '@/main/browser-import/chromium-profiles'

const CHROME = BROWSER_SOURCES.find(({ id }) => id === 'chrome') as BrowserSource
const ARC = BROWSER_SOURCES.find(({ id }) => id === 'arc') as BrowserSource

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'sim-browser-profiles-test-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** Writes a profile directory holding a database at `relativePath`. */
async function addProfile(
  source: BrowserSource,
  dir: string,
  relativePath = join('Network', 'Cookies')
): Promise<void> {
  const path = join(userDataDirFor(source, home), dir, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '')
}

async function writeLocalState(
  source: BrowserSource,
  infoCache: Record<string, unknown>
): Promise<void> {
  const userDataDir = userDataDirFor(source, home)
  await mkdir(userDataDir, { recursive: true })
  await writeFile(
    join(userDataDir, 'Local State'),
    JSON.stringify({ profile: { info_cache: infoCache } })
  )
}

describe('listBrowserProfiles', () => {
  it('returns display names, default profile first, with namespaced ids', async () => {
    await addProfile(CHROME, 'Profile 2')
    await addProfile(CHROME, 'Default')
    await writeLocalState(CHROME, { Default: { name: 'Person 1' }, 'Profile 2': { name: 'Work' } })

    const profiles = await listBrowserProfiles(CHROME, home)

    expect(profiles.map(({ id, label }) => ({ id, label }))).toEqual([
      // `Person 1` is Chromium's placeholder, so it reads as unnamed.
      { id: 'chrome:Default', label: '' },
      { id: 'chrome:Profile 2', label: 'Work' },
    ])
    expect(profiles[0].cookiesPath).toBe(
      join(userDataDirFor(CHROME, home), 'Default/Network/Cookies')
    )
    expect(profiles[0].source.id).toBe('chrome')
  })

  it('refuses profile keys that would escape the user-data directory', async () => {
    // Local State is data this process does not own, so a crafted key must not
    // become a path.
    await addProfile(CHROME, 'Default')
    await writeLocalState(CHROME, {
      Default: { name: 'Person 1' },
      '../../../../etc': { name: 'Escaped' },
      '/absolute/elsewhere': { name: 'Absolute' },
    })

    const profiles = await listBrowserProfiles(CHROME, home)
    expect(profiles.map(({ id }) => id)).toEqual(['chrome:Default'])
  })

  it('refuses a profile directory redirected through a symlink', async () => {
    const outsideProfile = join(home, 'outside-profile')
    await mkdir(outsideProfile, { recursive: true })
    await writeFile(join(outsideProfile, 'Login Data'), '')
    const userDataDir = userDataDirFor(CHROME, home)
    await mkdir(userDataDir, { recursive: true })
    await symlink(outsideProfile, join(userDataDir, 'Default'))
    await writeLocalState(CHROME, { Default: { name: 'Person 1' } })

    await expect(listBrowserProfiles(CHROME, home)).resolves.toEqual([])
  })

  it('refuses symlinked, hard-linked, and non-file password databases', async () => {
    const outsideDatabase = join(home, 'outside-login-data')
    await writeFile(outsideDatabase, '')

    const userDataDir = userDataDirFor(CHROME, home)
    for (const directory of ['Default', 'Profile 2', 'Profile 3']) {
      await mkdir(join(userDataDir, directory), { recursive: true })
    }
    await symlink(outsideDatabase, join(userDataDir, 'Default', 'Login Data For Account'))
    await link(outsideDatabase, join(userDataDir, 'Profile 2', 'Login Data For Account'))
    await mkdir(join(userDataDir, 'Profile 3', 'Login Data For Account'))

    await expect(listBrowserProfiles(CHROME, home)).resolves.toEqual([])
  })
})

describe('listAllBrowserProfiles', () => {
  it('keeps every profile distinct even though each browser has a Default', async () => {
    // The namespaced id is what stops one browser's Default from resolving to
    // another's.
    await addProfile(CHROME, 'Default')
    await addProfile(ARC, 'Default')

    const profiles = await listAllBrowserProfiles([CHROME, ARC], home)
    expect(new Set(profiles.map(({ id }) => id)).size).toBe(2)
  })

  it('does not let one broken browser hide the others', async () => {
    await addProfile(CHROME, 'Default')
    const broken: BrowserSource = {
      ...ARC,
      // A path that cannot be enumerated stands in for a damaged install.
      userDataSegments: ['\u0000invalid'],
    }

    const profiles = await listAllBrowserProfiles([broken, CHROME], home)
    expect(profiles.map(({ id }) => id)).toEqual(['chrome:Default'])
  })
})
