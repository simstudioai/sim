import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const GENERATOR = fileURLToPath(new URL('./sync-platform-recipes.ts', import.meta.url))
const START = '/* BEGIN GENERATED PAPER RECIPE VALUES */'
const END = '/* END GENERATED PAPER RECIPE VALUES */'

it('updates the active recipe section without changing handwritten CSS and rejects ambiguous bounds', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-platform-recipes-'))
  const write = (file: string, content: string) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const run = () =>
    spawnSync('bun', [GENERATOR, 'references', 'jsx'], { cwd: root, encoding: 'utf8' })
  const stylesheet = 'packages/emcn-platform/src/styles/platform.css'
  const catalog = 'packages/emcn-platform/src/catalog'
  try {
    symlinkSync(
      path.resolve(path.dirname(GENERATOR), '../node_modules'),
      path.join(root, 'node_modules'),
      'dir'
    )
    const files = Object.fromEntries(
      [
        'platform',
        'chat',
        'workspaces',
        'shared_light',
        'shared_dark',
        'platform_light',
        'platform_dark',
      ].map((name) => [name, { id: name }])
    )
    const base = { fileId: 'shared_light', pageId: 'library', nodeId: 'base' }
    const seedKeys = ['C0953', 'C0954', 'C1171', 'C1173', 'C1180', 'C1181', 'C9000']
    write(
      'references/registry.json',
      JSON.stringify({
        files,
        components: [
          {
            key: 'C9000',
            family: 'Example',
            theme: 'L',
            baseFileId: 'shared_light',
            occurrences: [{ fileId: 'platform', pageId: 'product', nodeId: 'use', role: 'Use' }],
          },
        ],
      })
    )
    write(
      'references/recipe-contracts.json',
      JSON.stringify({
        components: Object.fromEntries(seedKeys.map((key) => [key, { base, root: {}, parts: [] }])),
      })
    )
    write(
      'jsx/C9000.jsx',
      '<div id="base" style={{maskImage: "linear-gradient(to right, black, transparent)"}} />'
    )
    write(`${catalog}/variants.json`, '{}')
    write('packages/emcn/src/styles/generated/tokens.css', '[data-emcn] { --spacing-0: 0; }')
    const prefix = '[data-platform-ui] { --handwritten-before: 1; }\n'
    const suffix = '\n[data-platform-ui] { --handwritten-after: 2; }\n'
    const source = `${prefix}${START}\n[data-platform-ui] { --paper-stale: 0; }\n${END}${suffix}`
    write(stylesheet, source)
    const result = run()
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const updated = readFileSync(path.join(root, stylesheet), 'utf8')
    expect(updated.slice(0, updated.indexOf(START))).toBe(prefix)
    expect(updated.slice(updated.indexOf(END) + END.length)).toBe(suffix)
    expect(updated).toMatch(
      /--paper-mask-image-[a-f0-9]+:\s*linear-gradient\(to right, black, transparent\)/
    )
    expect(updated).not.toContain('--paper-stale')
    expect(existsSync(path.join(root, 'packages/emcn-platform/src/styles/recipe-values.css'))).toBe(
      false
    )

    for (const invalid of [
      source.replace(START, ''),
      source.replace(END, ''),
      `${source}\n${START}`,
      source.replace(START, END).replace(`${END}${suffix}`, `${START}${suffix}`),
    ]) {
      write(stylesheet, invalid)
      write(`${catalog}/recipes.json`, 'do not overwrite')
      const rejected = run()
      expect(rejected.status, rejected.stdout + rejected.stderr).toBe(1)
      expect(rejected.stderr).toContain('exactly one ordered generated recipe section')
      expect(readFileSync(path.join(root, stylesheet), 'utf8')).toBe(invalid)
      expect(readFileSync(path.join(root, catalog, 'recipes.json'), 'utf8')).toBe(
        'do not overwrite'
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
