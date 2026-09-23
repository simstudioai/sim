import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyze } from '#design-diff/analyze'
import { GitReader } from '#design-diff/git'
import { Metrics, measurements } from '#design-diff/metrics'
import { serializeReport } from '#design-diff/report'
import { SourceTree } from '#design-diff/source'
import { IndexStore } from '#design-diff/store'
import { config, FixtureRepo } from '#design-diff/tests/helpers'
import type { Config } from '#design-diff/types'
import { Database } from 'bun:sqlite'

const settings: Config = { ...config, themes: [] }
const repo = new FixtureRepo()
const directory = mkdtempSync(path.join(os.tmpdir(), 'design-index-test-'))
const mode = process.argv[2]
const file = 'apps/sim/panel space\tline\n.tsx'
const tokens = 'apps/sim/palette.ts'
const indexCLI = path.resolve(new URL('../index-cli.ts', import.meta.url).pathname)
const diffCLI = path.resolve(new URL('../cli.ts', import.meta.url).pathname)
try {
  const base = repo.commit({
    [tokens]: 'export const palette={control:{color:"red",padding:4},service:{retry:2}}',
    [file]:
      'import {palette} from "./palette";export const Panel=()=> <button style={{color:palette.control.color,padding:palette.control.padding}}>Save</button>',
  })
  const head = repo.commit({
    [tokens]: 'export const palette={control:{color:"blue",padding:4},service:{retry:2}}',
  })
  const fresh = () => analyze(repo.cwd, base, head, settings).then(serializeReport)
  const cached = async (left = base, right = head, options = settings) => {
    const metrics = new Metrics()
    return measurements.run(metrics, async () => {
      const index = await IndexStore.open(directory, options)
      try {
        return {
          report: serializeReport(await analyze(repo.cwd, left, right, options, index)),
          metrics: metrics.snapshot(),
        }
      } finally {
        index.close()
      }
    })
  }
  const cli = (script: string, args: string[]) =>
    execFileSync(process.execPath, ['--no-env-file', script, ...args], {
      cwd: repo.cwd,
      stdio: 'pipe',
    })
  if (mode === 'parity') {
    const reference = await fresh()
    assert.equal((await cached()).report, reference)
    const warm = await cached()
    assert.equal(warm.report, reference)
    assert(warm.metrics.counters['cache.hits'] > 0)
    const cosmetic = repo.commit({
      [file]:
        '\n\nimport {palette} from "./palette";export const Panel=()=> <button style={{color:palette.control.color,padding:palette.control.padding}}>Save</button>',
    })
    assert.equal(
      (await cached(base, cosmetic)).report,
      serializeReport(await analyze(repo.cwd, base, cosmetic, settings))
    )
  } else if (mode === 'processes') {
    cli(indexCLI, ['--ref', base, '--cache-dir', directory])
    const output = path.join(directory, 'report.json')
    const metrics = path.join(directory, 'metrics.json')
    cli(diffCLI, [
      '--base',
      base,
      '--head',
      head,
      '--cache-dir',
      directory,
      '--output',
      output,
      '--metrics',
      metrics,
    ])
    const first = readFileSync(output, 'utf8')
    assert(JSON.parse(readFileSync(metrics, 'utf8')).counters['cache.hits'] > 0)
    cli(diffCLI, ['--base', base, '--head', head, '--no-cache', '--output', output])
    assert.equal(readFileSync(output, 'utf8'), first)
    assert.throws(() =>
      cli(diffCLI, [
        '--base',
        'missing-ref',
        '--head',
        head,
        '--cache-dir',
        directory,
        '--output',
        output,
      ])
    )
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).flagged, null)
  } else if (mode === 'corruption') {
    await cached()
    writeFileSync(path.join(directory, 'index.sqlite'), 'invalid SQLite')
    assert.equal((await cached()).report, await fresh())
    const db = new Database(path.join(directory, 'index.sqlite'))
    db.exec("UPDATE entries SET checksum='broken'; PRAGMA user_version=99;")
    db.close()
    assert.equal((await cached()).report, await fresh())
  } else if (mode === 'concurrent') {
    const outputs = ['a', 'b'].map((name) => path.join(directory, `${name}.json`))
    const children = outputs.map((output) =>
      Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          diffCLI,
          '--base',
          base,
          '--head',
          head,
          '--cache-dir',
          directory,
          '--output',
          output,
        ],
        { cwd: repo.cwd, stdout: 'ignore', stderr: 'ignore' }
      )
    )
    assert.deepEqual(await Promise.all(children.map((child) => child.exited)), [0, 0])
    assert.equal(readFileSync(outputs[0], 'utf8'), readFileSync(outputs[1], 'utf8'))
    const output = path.join(directory, 'fresh.json')
    cli(diffCLI, ['--base', base, '--head', head, '--no-cache', '--output', output])
    assert.equal(readFileSync(outputs[0], 'utf8'), readFileSync(output, 'utf8'))
  } else if (mode === 'resolution') {
    const unresolved = repo.commit({
      [file]:
        'import {shade} from "./later";export const Panel=()=> <button style={{color:shade}}/>',
    })
    await cached(head, unresolved)
    const resolved = repo.commit({ 'apps/sim/later.ts': 'export const shade="green"' })
    assert.equal(
      (await cached(unresolved, resolved)).report,
      serializeReport(await analyze(repo.cwd, unresolved, resolved, settings))
    )
    const alias = repo.commit({
      'apps/sim/tsconfig.json': '{"compilerOptions":{"paths":{"@shade":["./later"]}}}',
      [file]:
        'import {shade} from "@shade";export const Panel=()=> <button style={{color:shade}}/>',
    })
    assert.equal(
      (await cached(unresolved, alias)).report,
      serializeReport(await analyze(repo.cwd, unresolved, alias, settings))
    )
    const deleted = repo.commit({ 'apps/sim/later.ts': null })
    assert.equal(
      (await cached(alias, deleted)).report,
      serializeReport(await analyze(repo.cwd, alias, deleted, settings))
    )
    repo.git('mv', file, 'apps/sim/renamed.tsx')
    const renamed = repo.commit({})
    assert.equal(
      (await cached(deleted, renamed)).report,
      serializeReport(await analyze(repo.cwd, deleted, renamed, settings))
    )
  } else if (mode === 'configuration') {
    await cached()
    const configured = { ...settings, exclude: [...settings.exclude, 'palette|panel'] }
    assert.equal(
      (await cached(base, head, configured)).report,
      serializeReport(await analyze(repo.cwd, base, head, configured))
    )
  } else if (mode === 'snapshots') {
    const snapshot = async (commits: string[]) => {
      const index = await IndexStore.open(directory, settings, 1024 * 1024, 2)
      for (const commit of commits) {
        const tree = new SourceTree(new GitReader(repo.cwd), commit, settings, index)
        tree.buildGraph()
        tree.complete()
      }
      index.close()
      const db = new Database(path.join(directory, 'index.sqlite'))
      const rows = db.query('SELECT commit_id,checksum FROM snapshots ORDER BY commit_id').all()
      db.close()
      return rows
    }
    const forward = await snapshot([base, head])
    assert.deepEqual(await snapshot([head, base]), forward)
    const third = repo.commit({ 'README.md': 'third' })
    assert.equal((await snapshot([third])).length, 2)
    const tiny = await IndexStore.open(directory, settings, 32768, 2)
    for (let i = 0; i < 30; i++) tiny.put(`large${i}`, 'x'.repeat(8000))
    tiny.close()
    assert.equal((await cached()).report, await fresh())
  } else if (mode === 'sentinels') {
    const marker = path.join(repo.cwd, 'APPLICATION_EXECUTED')
    const loaded = repo.commit({
      [tokens]: `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)}, 'unsafe');export const palette={control:{color:'green',padding:4}}`,
      'apps/sim/app/globals.css': '@import "tailwindcss";@plugin "../../plugin.js";',
      'apps/sim/plugin.js': `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`,
      'apps/sim/cycle-a.ts': 'export {a} from "./cycle-b"',
      'apps/sim/cycle-b.ts': 'export {a} from "./cycle-a"',
      'apps/sim/broken.tsx': 'export const Broken=()=> <button',
    })
    assert.equal(
      (await cached(base, loaded, config)).report,
      serializeReport(await analyze(repo.cwd, base, loaded, config))
    )
    assert.equal(
      (await cached(base, loaded, config)).report,
      serializeReport(await analyze(repo.cwd, base, loaded, config))
    )
    assert.equal(existsSync(marker), false)
  } else if (mode === 'restart') {
    await cached()
    const script =
      "import {Database} from 'bun:sqlite';const db=new Database(process.argv[1]);db.exec(\"BEGIN;DELETE FROM entries;\");process.kill(process.pid, 'SIGKILL');"
    assert.throws(() =>
      execFileSync(
        process.execPath,
        ['--no-env-file', '-e', script, path.join(directory, 'index.sqlite')],
        { stdio: 'pipe' }
      )
    )
    assert.equal((await cached()).report, await fresh())
  } else if (mode === 'missing-source') {
    await cached()
    const blob = repo.git('rev-parse', `${base}:${file}`)
    rmSync(path.join(repo.cwd, '.git/objects', blob.slice(0, 2), blob.slice(2)))
    await assert.rejects(cached(), /Unreadable Git blob metadata/)
    await assert.rejects(fresh(), /Unreadable Git blob metadata/)
  } else if (mode === 'themes') {
    const theme = 'apps/sim/app/globals.css'
    const themedBase = repo.commit({
      [theme]: '@import "tailwindcss"; @theme { --color-primary: red; }',
      [file]: 'export const Panel=()=> <button className="bg-primary p-2"/>',
    })
    const themedHead = repo.commit({
      [theme]: '@import "tailwindcss"; @theme { --color-primary: blue; }',
    })
    const first = await cached(themedBase, themedHead, config)
    assert.equal(
      first.report,
      serializeReport(await analyze(repo.cwd, themedBase, themedHead, config))
    )
    assert.equal((await cached(themedBase, themedHead, config)).report, first.report)
  } else throw new Error('Unknown test mode')
} finally {
  repo.close()
  rmSync(directory, { recursive: true, force: true })
}
