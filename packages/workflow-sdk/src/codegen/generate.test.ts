import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURE_WORKSPACE } from '../../test/fixtures/workspace'
import {
  loadFixtureCatalog as loadCatalog,
  typecheck,
  writeTypecheckProject,
} from '../../test/typecheck-project'
import { generateSdkTypes } from './generate'
import { generateWorkspaceTypes } from './workspace'

function reversedKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse())
}

describe('generateSdkTypes over the fixture catalog', () => {
  it('is byte-identical across runs and independent of catalog key order', () => {
    const catalog = loadCatalog()
    const first = generateSdkTypes(catalog)
    const second = generateSdkTypes(loadCatalog())
    const shuffled = generateSdkTypes({
      ...catalog,
      blocks: reversedKeys(catalog.blocks),
      triggers: reversedKeys(catalog.triggers),
      builders: reversedKeys(catalog.builders),
    })
    expect(second).toEqual(first)
    expect(shuffled).toEqual(first)
  })

  it('touches only the changed block files when one block changes', () => {
    const catalog = loadCatalog()
    const before = new Map(generateSdkTypes(catalog).map((file) => [file.path, file.text]))
    const changed = structuredClone(catalog)
    const url = changed.blocks.api.subBlocks.find((subBlock) => subBlock.id === 'url')
    if (!url) throw new Error('fixture api block has no url subBlock')
    url.title = 'Endpoint URL'
    const after = generateSdkTypes(changed)
    const touched = after.filter((file) => before.get(file.path) !== file.text).map((f) => f.path)
    expect(touched).toEqual(['blocks/api.d.ts'])
  })

  it('type-checks the s2 example workflows and rejects every negative fixture', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'sim-sdk-types-'))
    try {
      const { tsconfig } = writeTypecheckProject(outDir)
      expect(typecheck(tsconfig)).toBe('')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects a builder name the emitter cannot declare', () => {
    const catalog = loadCatalog()
    expect(() =>
      generateSdkTypes({
        ...catalog,
        builders: { ...catalog.builders, 'slack.delete': { type: 'slack_v2' } },
      })
    ).toThrow(/cannot name a declaration/)
    expect(() =>
      generateSdkTypes({ ...catalog, builders: { ...catalog.builders, env: { type: 'api' } } })
    ).toThrow(/redeclares a core export/)
    expect(() =>
      generateSdkTypes({
        ...catalog,
        builders: { ...catalog.builders, 'slack.tool': { type: 'slack_v2' } },
      })
    ).toThrow(/collides with the `tool` namespace/)
  })
})

describe('generateWorkspaceTypes', () => {
  it('is independent of manifest key order', () => {
    const reversed = {
      ...FIXTURE_WORKSPACE,
      tables: reversedKeys(FIXTURE_WORKSPACE.tables ?? {}),
      bindings: reversedKeys(FIXTURE_WORKSPACE.bindings ?? {}),
      env: [...(FIXTURE_WORKSPACE.env ?? [])].reverse(),
    }
    expect(generateWorkspaceTypes(reversed)).toEqual(generateWorkspaceTypes(FIXTURE_WORKSPACE))
  })
})
