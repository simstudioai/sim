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
import { defaultBlockFiles, fullBlockFiles, referencedBlockTypes } from './layout'
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

  it('type-checks the example workflows and rejects every negative fixture', () => {
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

/** The fixture catalog plus a hidden older Slack version whose only builders are legacy ones. */
function catalogWithLegacySlack() {
  const catalog = loadCatalog()
  return {
    ...catalog,
    blocks: { ...catalog.blocks, slack: { ...catalog.blocks.slack_v2, type: 'slack' } },
    builders: {
      ...catalog.builders,
      'legacy.slack.sendMessage': { ...catalog.builders['slack.sendMessage'], type: 'slack' },
    },
  }
}

describe('the SDK layout', () => {
  it('indexes every builder by block, operation, file and params type, legacy ones apart', () => {
    const files = generateSdkTypes(catalogWithLegacySlack())
    const index = files.find((file) => file.path === 'INDEX.md')?.text ?? ''
    const [current, legacy] = index.split('## Legacy builders')

    expect(current).toContain(
      '- `slack.sendMessage` — Slack: Send Message → `blocks/slack_v2.d.ts` (`SlackSendMessageParams`)'
    )
    expect(current).toContain(
      '- `runWorkflow` — Workflow → `blocks/workflow_input.d.ts` (`RunWorkflowParams`)'
    )
    expect(current).not.toContain('legacy.slack')
    expect(legacy).toContain(
      '- `legacy.slack.sendMessage` — Slack: Send Message → `blocks/slack.d.ts` (`LegacySlackSendMessageParams`)'
    )
  })

  it('writes one file per block, and leaves legacy-only blocks out of index.d.ts', () => {
    const files = generateSdkTypes(catalogWithLegacySlack())
    const index = files.find((file) => file.path === 'index.d.ts')?.text ?? ''

    expect(
      files.filter(
        (file) => !/^(blocks\/[\w-]+\.d\.ts|models\.d\.ts|index\.d\.ts|INDEX\.md)$/.test(file.path)
      )
    ).toEqual([])
    expect(files.some((file) => file.path === 'blocks/slack.d.ts')).toBe(true)
    expect(index).toContain("import './blocks/slack_v2'")
    expect(index).not.toContain("import './blocks/slack'\n")
  })

  it('lists the operations of a block in its namespace doc comment', () => {
    const slack = generateSdkTypes(loadCatalog()).find(
      (file) => file.path === 'blocks/slack_v2.d.ts'
    )

    expect(slack?.text).toMatch(
      /\* Slack \(`slack_v2`\) builders:\n[^/]* \* `sendMessage`: Slack: Send Message\n[\s\S]*export namespace slack \{/
    )
  })

  it('finds the blocks a source calls, through tool forms and spacing, and keeps the core builders', () => {
    const catalog = catalogWithLegacySlack()
    const used = referencedBlockTypes(catalog, [
      "const a = gmail\n  .sendEmail('A', {})",
      "agent('B', { tools: [slack.tool.sendMessage({}), runWorkflow.tool({})] })",
      "legacy.slack.sendMessage('C', {})",
      '// table.queryRows, without a call, and loop.forEach(), no builder',
    ])

    expect(used).toEqual(['agent', 'gmail_v2', 'slack', 'slack_v2', 'workflow_input'])
    const defaults = defaultBlockFiles(catalog, used)
    expect(defaults).toContain('blocks/router_v2.d.ts')
    expect(defaults).toContain('blocks/gmail_v2.d.ts')
    expect(defaults).not.toContain('blocks/google_sheets_v2.d.ts')
    expect(fullBlockFiles(catalog, used)).toEqual(['index.d.ts', 'blocks/slack.d.ts'])
  })
})

describe('generateWorkspaceTypes', () => {
  it('is independent of manifest key order', () => {
    const reversed = {
      ...FIXTURE_WORKSPACE,
      tables: reversedKeys(FIXTURE_WORKSPACE.tables ?? {}),
      credentials: reversedKeys(FIXTURE_WORKSPACE.credentials ?? {}),
      env: [...(FIXTURE_WORKSPACE.env ?? [])].reverse(),
    }
    expect(generateWorkspaceTypes(reversed)).toEqual(generateWorkspaceTypes(FIXTURE_WORKSPACE))
  })
})
