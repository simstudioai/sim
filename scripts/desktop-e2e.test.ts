import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it.each([
  { index: 1, title: 'brand-new.test.ts' },
  { index: 2, title: 'factory' },
  { index: 3, title: 'ordinary.spec.ts' },
])('executes only $title on desktop shard $index/3', ({ index, title }) => {
  const root = resolve(import.meta.dirname, '..')
  const fixture = mkdtempSync(join(tmpdir(), 'desktop-shard-'))
  try {
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir')
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}')
    writeFileSync(
      join(fixture, 'playwright.config.ts'),
      "export default { testDir: './tests', workers: 1, retries: 0 }"
    )
    mkdirSync(join(fixture, 'tests/nested'), { recursive: true })
    mkdirSync(join(fixture, 'tests/support'), { recursive: true })
    writeFileSync(
      join(fixture, 'tests/support/factory.ts'),
      "import { test } from '@playwright/test'; export function register() { test('factory', () => {}); }"
    )
    writeFileSync(
      join(fixture, 'tests/nested/a[1].spec.ts'),
      "import { register } from '../support/factory'; register();"
    )
    for (const file of ['brand-new.test.ts', 'ordinary.spec.ts']) {
      writeFileSync(
        join(fixture, 'tests', file),
        `import { test } from '@playwright/test'; test('${file}', () => {});`
      )
    }
    const cases: { title: string; status: string }[] = []
    const reportPath = join(fixture, `${index}.json`)
    const result = spawnSync('bun', ['run', join(root, 'scripts/desktop-e2e.ts'), `${index}/3`], {
      cwd: fixture,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      suites: { specs: { title: string; tests: { results: { status: string }[] }[] }[] }[]
    }
    for (const suite of report.suites) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          for (const run of test.results) cases.push({ title: spec.title, status: run.status })
        }
      }
    }
    expect(cases).toEqual([{ title, status: 'passed' }])
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
