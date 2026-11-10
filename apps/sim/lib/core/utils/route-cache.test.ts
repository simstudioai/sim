import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearRouteCacheFromOtherBuild } from '@/lib/core/utils/route-cache'

let nextDirectory: string
let routeCache: string

beforeEach(async () => {
  nextDirectory = await mkdtemp(join(tmpdir(), 'route-cache-'))
  routeCache = join(nextDirectory, 'server', 'route-cache')
  await mkdir(join(routeCache, 'app-page'), { recursive: true })
  await writeFile(join(routeCache, 'app-page', 'contact.html'), '<html>old build</html>')
  await writeFile(join(nextDirectory, 'BUILD_ID'), 'build-2\n')
})

afterEach(async () => {
  await rm(nextDirectory, { recursive: true, force: true })
})

describe('clearRouteCacheFromOtherBuild', () => {
  it('clears pages rendered by an earlier build', async () => {
    await writeFile(join(routeCache, '.build-id'), 'build-1')
    await clearRouteCacheFromOtherBuild(nextDirectory)
    expect(await readdir(routeCache)).toEqual(['.build-id'])
  })

  it('clears a cache that records no build', async () => {
    await clearRouteCacheFromOtherBuild(nextDirectory)
    expect(await readdir(routeCache)).toEqual(['.build-id'])
  })

  it('keeps pages rendered by the current build across restarts', async () => {
    await clearRouteCacheFromOtherBuild(nextDirectory)
    await writeFile(join(routeCache, 'app-page.html'), '<html>current build</html>')
    await clearRouteCacheFromOtherBuild(nextDirectory)
    expect((await readdir(routeCache)).sort()).toEqual(['.build-id', 'app-page.html'])
  })

  it('leaves the cache alone when the build id is unreadable', async () => {
    await rm(join(nextDirectory, 'BUILD_ID'))
    await clearRouteCacheFromOtherBuild(nextDirectory)
    expect(await readdir(routeCache)).toEqual(['app-page'])
  })
})
