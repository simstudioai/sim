import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

  it('orders numbered profiles numerically rather than as strings', async () => {
    for (const dir of ['Profile 10', 'Profile 2', 'Default']) await addProfile(CHROME, dir)

    const profiles = await listBrowserProfiles(CHROME, home)
    expect(profiles.map(({ id }) => id)).toEqual([
      'chrome:Default',
      'chrome:Profile 2',
      'chrome:Profile 10',
    ])
  })

  it('finds the cookie database at the pre-M96 location', async () => {
    await addProfile(CHROME, 'Default', 'Cookies')

    const [profile] = await listBrowserProfiles(CHROME, home)
    expect(profile.cookiesPath).toBe(join(userDataDirFor(CHROME, home), 'Default/Cookies'))
  })

  it('finds the saved-password database alongside the cookies', async () => {
    await addProfile(CHROME, 'Default')
    await addProfile(CHROME, 'Default', 'Login Data')

    const [profile] = await listBrowserProfiles(CHROME, home)
    expect(profile.loginDataPath).toBe(join(userDataDirFor(CHROME, home), 'Default/Login Data'))
  })

  it('lists a profile that has only saved passwords', async () => {
    // Passwords and cookies import independently, so a profile with one and
    // not the other must still be offered.
    await addProfile(CHROME, 'Default', 'Login Data')

    const [profile] = await listBrowserProfiles(CHROME, home)
    expect(profile).toMatchObject({ id: 'chrome:Default', cookiesPath: null })
  })

  it('omits profiles with no readable database', async () => {
    await mkdir(join(userDataDirFor(CHROME, home), 'Profile 3'), { recursive: true })
    await addProfile(CHROME, 'Default')

    const profiles = await listBrowserProfiles(CHROME, home)
    expect(profiles.map(({ id }) => id)).toEqual(['chrome:Default'])
  })

  it('ignores internal profiles', async () => {
    await addProfile(CHROME, 'System Profile')
    await addProfile(CHROME, 'Guest Profile')
    await addProfile(CHROME, 'Default')

    const profiles = await listBrowserProfiles(CHROME, home)
    expect(profiles.map(({ id }) => id)).toEqual(['chrome:Default'])
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

  it('falls back to directory names when Local State is unreadable', async () => {
    await addProfile(CHROME, 'Default')
    await writeFile(join(userDataDirFor(CHROME, home), 'Local State'), 'not json{{')

    const profiles = await listBrowserProfiles(CHROME, home)
    expect(profiles.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'chrome:Default', label: '' },
    ])
  })

  it('skips a browser\u2019s internal profiles', async () => {
    // Arc keeps `__ARC_SYSTEM_PROFILE` in an ordinary `Profile N` directory,
    // so only the name gives it away.
    await addProfile(ARC, 'Default')
    await addProfile(ARC, 'Profile 1')
    await addProfile(ARC, 'Profile 2')
    await writeLocalState(ARC, {
      Default: { name: 'Your Chromium' },
      'Profile 1': { name: '__ARC_SYSTEM_PROFILE' },
      'Profile 2': { name: 'Microtrades' },
    })

    const profiles = await listBrowserProfiles(ARC, home)

    expect(profiles.map(({ id }) => id)).toEqual(['arc:Default', 'arc:Profile 2'])
  })

  it.each([['Your Chrome'], ['Your Chromium'], ['Person 1'], ['Default'], ['Chrome']])(
    'treats the placeholder name %s as unnamed',
    async (name) => {
      await addProfile(CHROME, 'Default')
      await writeLocalState(CHROME, { Default: { name } })

      const [profile] = await listBrowserProfiles(CHROME, home)
      expect(profile.label).toBe('')
    }
  )

  it('keeps a name the user actually chose', async () => {
    await addProfile(CHROME, 'Default')
    await writeLocalState(CHROME, { Default: { name: 'sim.ai' } })

    const [profile] = await listBrowserProfiles(CHROME, home)
    expect(profile.label).toBe('sim.ai')
  })

  it('reports no profiles when the browser is not installed', async () => {
    await expect(listBrowserProfiles(ARC, home)).resolves.toEqual([])
  })
})

describe('listAllBrowserProfiles', () => {
  it('collects profiles from every installed browser', async () => {
    await addProfile(CHROME, 'Default')
    await addProfile(ARC, 'Default')
    await addProfile(ARC, 'Profile 1')
    await writeLocalState(ARC, { Default: { name: 'Personal' }, 'Profile 1': { name: 'Work' } })

    const profiles = await listAllBrowserProfiles([CHROME, ARC], home)

    expect(profiles.map(({ id }) => id)).toEqual(['chrome:Default', 'arc:Default', 'arc:Profile 1'])
    expect(profiles.map(({ source }) => source.label)).toEqual(['Chrome', 'Arc', 'Arc'])
  })

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

  it('reports nothing when no supported browser is installed', async () => {
    await expect(listAllBrowserProfiles([CHROME, ARC], home)).resolves.toEqual([])
  })
})
