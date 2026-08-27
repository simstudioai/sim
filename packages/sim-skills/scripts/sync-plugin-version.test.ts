import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncPluginVersion } from './sync-plugin-version'

describe('syncPluginVersion', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    )
  })

  it('copies the package version into both plugin manifests', async () => {
    const packageRoot = await mkdtemp(resolve(tmpdir(), 'sim-skills-version-'))
    temporaryDirectories.push(packageRoot)
    await Promise.all([
      mkdir(resolve(packageRoot, '.codex-plugin')),
      mkdir(resolve(packageRoot, '.claude-plugin')),
    ])
    await Promise.all([
      writeFile(
        resolve(packageRoot, 'package.json'),
        JSON.stringify({ name: 'sim-skills', version: '0.2.0-preview.10.1' })
      ),
      writeFile(
        resolve(packageRoot, '.codex-plugin', 'plugin.json'),
        JSON.stringify({ name: 'sim', version: '0.1.0', skills: './skills/' })
      ),
      writeFile(
        resolve(packageRoot, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'sim', version: '0.1.0', skills: './skills/' })
      ),
    ])

    await expect(syncPluginVersion(packageRoot)).resolves.toBe('0.2.0-preview.10.1')
    const versions = await Promise.all(
      ['.codex-plugin', '.claude-plugin'].map(async (directory) => {
        const manifest: unknown = JSON.parse(
          await readFile(resolve(packageRoot, directory, 'plugin.json'), 'utf8')
        )
        if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) {
          throw new Error(`${directory}/plugin.json: version is required`)
        }
        return manifest.version
      })
    )
    expect(versions).toEqual(['0.2.0-preview.10.1', '0.2.0-preview.10.1'])
  })

  it('fails when a plugin manifest is missing', async () => {
    const packageRoot = await mkdtemp(resolve(tmpdir(), 'sim-skills-version-'))
    temporaryDirectories.push(packageRoot)
    await writeFile(
      resolve(packageRoot, 'package.json'),
      JSON.stringify({ name: 'sim-skills', version: '0.2.0' })
    )

    await expect(syncPluginVersion(packageRoot)).rejects.toThrow('plugin.json')
  })
})
