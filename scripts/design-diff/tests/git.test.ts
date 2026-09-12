import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { analyze } from '#design-diff/analyze'
import { GitReader } from '#design-diff/git'
import { compareFiles, config, FixtureRepo } from '#design-diff/tests/helpers'

it('compares the merge-base after staging diverges', async () => {
  const repo = new FixtureRepo()
  try {
    const common = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div>Original</div>' })
    repo.git('checkout', '-b', 'feature')
    const head = repo.commit({ 'README.md': 'A nonvisual change' })
    repo.git('checkout', 'staging')
    const base = repo.commit({ 'apps/sim/a.tsx': 'export const A=()=> <div>Staging edit</div>' })
    const report = await analyze(repo.cwd, base, head, config)
    expect(report.commits?.mergeBase).toBe(common)
    expect(report.flagged).toBe(false)
  } finally {
    repo.close()
  }
})

it('handles binary assets, deletions and filenames containing spaces, tabs and newlines', async () => {
  const file = 'apps/sim/public/icon space\tline\n.png'
  const changed = await compareFiles(
    { [file]: Buffer.from([0, 1, 255]) },
    { [file]: Buffer.from([0, 2, 255]) }
  )
  expect(changed.flagged).toBe(false)
  expect(changed.status).toBe('completed')
  const removed = await compareFiles({ [file]: Buffer.from([0, 1, 255]) }, { [file]: null })
  expect(removed.flagged).toBe(false)
  const styled = 'apps/sim/component space\tline\n.tsx'
  const appearance = await compareFiles(
    { [styled]: 'export const A=()=> <div className="p-2"/>' },
    { [styled]: null }
  )
  expect(appearance.flagged).toBe(true)
  expect(appearance.findings[0].before?.location.file).toBe(styled)
  expect(appearance.findings[0].after).toBeNull()
})

it('handles renames and modifications without losing their old location', async () => {
  const repo = new FixtureRepo()
  try {
    const base = repo.commit({
      'apps/sim/old.tsx': 'export const A=()=> <button style={{color:"red"}}>Move me</button>\n',
    })
    repo.git('mv', 'apps/sim/old.tsx', 'apps/sim/new name.tsx')
    const rename = repo.commit({})
    expect((await analyze(repo.cwd, base, rename, config)).flagged).toBe(false)
    const head = repo.commit({
      'apps/sim/new name.tsx':
        'export const A=()=> <button style={{color:"blue"}}>Move me</button>\n',
    })
    expect((await analyze(repo.cwd, base, head, config)).flagged).toBe(true)
  } finally {
    repo.close()
  }
})

it('fails explicitly for unreadable revisions and missing history', async () => {
  const repo = new FixtureRepo()
  const shallow = mkdtempSync(path.join(os.tmpdir(), 'design-diff-shallow-'))
  try {
    const base = repo.commit({ 'README.md': 'first' })
    repo.commit({ 'README.md': 'second' })
    expect(() => new GitReader(repo.cwd).compare('--help', 'HEAD')).toThrow()
    await expect(analyze(repo.cwd, 'not-a-ref', 'HEAD', config)).rejects.toThrow()
    execFileSync('git', ['clone', '--depth=1', `file://${repo.cwd}`, shallow], { stdio: 'pipe' })
    await expect(analyze(shallow, base, 'HEAD', config)).rejects.toThrow()
  } finally {
    repo.close()
    rmSync(shallow, { recursive: true, force: true })
  }
})
