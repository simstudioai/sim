import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyze } from '#design-diff/analyze'
import type { Config } from '#design-diff/types'

export const config: Config = JSON.parse(
  readFileSync(new URL('../../../design-diff.config.json', import.meta.url), 'utf8')
)
export type Files = Record<string, string | Buffer | null>

export class FixtureRepo {
  readonly cwd = mkdtempSync(path.join(os.tmpdir(), 'design-diff-'))
  constructor() {
    this.git('init', '--initial-branch=staging')
    this.git('config', 'user.email', 'fixture@example.invalid')
    this.git('config', 'user.name', 'Design diff fixture')
    this.git('config', 'commit.gpgsign', 'false')
  }
  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  }
  commit(files: Files): string {
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(this.cwd, file)
      if (contents === null) rmSync(target, { force: true })
      else {
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, contents)
      }
    }
    this.git('add', '--all')
    this.git('commit', '--allow-empty', '-m', 'fixture')
    return this.git('rev-parse', 'HEAD')
  }
  close() {
    rmSync(this.cwd, { force: true, recursive: true })
  }
}

export async function compareFiles(before: Files, after: Files, settings: Config = config) {
  const repo = new FixtureRepo()
  try {
    const base = repo.commit(before)
    const head = repo.commit(after)
    return await analyze(repo.cwd, base, head, settings)
  } finally {
    repo.close()
  }
}
