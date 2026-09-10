import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { analyze } from '#design-diff/analyze'
import { config, FixtureRepo } from '#design-diff/tests/helpers'

it('never executes proposed source or JavaScript plugins', async () => {
  const repo = new FixtureRepo()
  const sentinel = path.join(repo.cwd, 'executed')
  const payload = `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'bad')`
  try {
    const base = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div/>' })
    const head = repo.commit({
      'apps/sim/a.tsx': `${payload};export const A=()=> <div className={(()=>{${payload};return 'p-4'})()}/>`,
      'apps/sim/postcss.config.cjs': `${payload};module.exports={}`,
      'apps/sim/app/_styles/globals.css':
        '@plugin "../../postcss.config.cjs"; @theme {--spacing:4px;}',
    })
    const report = await analyze(repo.cwd, base, head, config)
    expect(report.flagged).toBe(true)
    expect(
      report.findings.some((finding) => finding.reason === 'Rendering infrastructure changed')
    ).toBe(true)
    expect(existsSync(sentinel)).toBe(false)
  } finally {
    repo.close()
  }
})

it('writes failed JSON and exits nonzero for an operational failure', () => {
  const repo = new FixtureRepo()
  try {
    repo.commit({ 'README.md': 'fixture' })
    const output = path.join(repo.cwd, 'result.json')
    const cli = fileURLToPath(new URL('../cli.ts', import.meta.url))
    const run = spawnSync(
      'bun',
      ['--no-env-file', cli, '--base', 'missing', '--head', 'HEAD', '--output', output],
      { cwd: repo.cwd, encoding: 'utf8' }
    )
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      status: 'failed',
      flagged: null,
    })
  } finally {
    repo.close()
  }
})

it('exits successfully for completed flagged analysis and stays quiet with --output', () => {
  const repo = new FixtureRepo()
  try {
    const base = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div>First</div>' })
    const head = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div>Second</div>' })
    const output = path.join(repo.cwd, 'result.json')
    const cli = fileURLToPath(new URL('../cli.ts', import.meta.url))
    const stdout = execFileSync(
      'bun',
      ['--no-env-file', cli, '--base', base, '--head', head, '--output', output],
      { cwd: repo.cwd, encoding: 'utf8' }
    )
    expect(stdout).toBe('')
    expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
      status: 'completed',
      flagged: true,
    })
  } finally {
    repo.close()
  }
})

it('reviews an affected file beyond the source-size limit', async () => {
  const repo = new FixtureRepo()
  try {
    const base = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div/>' })
    const head = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div>Changed</div>' })
    const report = await analyze(repo.cwd, base, head, {
      ...config,
      limits: { ...config.limits, fileBytes: 10 },
    })
    expect(report.flagged).toBe(true)
    expect(report.findings[0].decision).toBe('review')
  } finally {
    repo.close()
  }
})
