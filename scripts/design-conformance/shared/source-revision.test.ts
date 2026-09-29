import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { git } from '#design-conformance/shared/io'
import { workingTreeRevision } from '#design-conformance/shared/source-revision'
import { GitSource } from '#design-conformance/shared/worktree-source'

function repository() {
  const repo = mkdtempSync(path.join(tmpdir(), 'design-revision-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  run('init', '-q')
  writeFileSync(path.join(repo, 'tracked.txt'), 'base')
  run('add', '.')
  run('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base')
  return repo
}

test('revision frames untracked paths and hashes dangling symlinks without dereferencing', () => {
  const repo = repository()
  try {
    writeFileSync(path.join(repo, 'a'), 'bc')
    const first = workingTreeRevision(repo)
    rmSync(path.join(repo, 'a'))
    writeFileSync(path.join(repo, 'ab'), 'c')
    const second = workingTreeRevision(repo)
    expect(second).not.toBe(first)
    symlinkSync('missing-target', path.join(repo, 'link'))
    expect(workingTreeRevision(repo)).not.toBe(second)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('Git helpers ignore inherited repository selectors', () => {
  const repo = repository()
  const previous = process.env.GIT_DIR
  try {
    process.env.GIT_DIR = path.join(repo, 'missing.git')
    expect(git(repo, ['rev-parse', 'HEAD']).toString().trim()).toMatch(/^[a-f\d]{40}$/)
    expect(workingTreeRevision(repo)).toMatch(/^[a-f\d]{64}$/)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'GIT_DIR')
    else process.env.GIT_DIR = previous
    rmSync(repo, { recursive: true, force: true })
  }
})
test('configured external diffs cannot hide tracked edits from the revision', () => {
  const repo = repository()
  try {
    const before = workingTreeRevision(repo)
    execFileSync('git', ['config', 'diff.external', 'true'], { cwd: repo })
    writeFileSync(path.join(repo, 'tracked.txt'), 'changed')
    expect(workingTreeRevision(repo)).not.toBe(before)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('sparse skip-worktree paths retain their immutable snapshot bytes', () => {
  const repo = repository()
  try {
    execFileSync('git', ['update-index', '--skip-worktree', 'tracked.txt'], { cwd: repo })
    rmSync(path.join(repo, 'tracked.txt'))
    const source = new GitSource(repo, 'HEAD', true)
    const entry = source.entries.find((item) => item.path === 'tracked.txt')
    expect(entry).toBeDefined()
    expect(source.read(entry!)).toBe('base')
    expect(() => source.assertUnchanged()).not.toThrow()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('a present skip-worktree source reads edited working bytes', () => {
  const repo = repository()
  try {
    const file = 'apps/sim/components/example.tsx'
    mkdirSync(path.join(repo, 'apps/sim/components'), { recursive: true })
    writeFileSync(path.join(repo, file), 'export const A=()=> <p/>')
    execFileSync('git', ['add', file], { cwd: repo })
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'source'],
      { cwd: repo }
    )
    execFileSync('git', ['update-index', '--skip-worktree', file], { cwd: repo })
    writeFileSync(path.join(repo, file), 'export const A=()=> <button/>')
    const source = new GitSource(repo, 'HEAD', true)
    const entry = source.entries.find((item) => item.path === file)
    expect(entry).toBeDefined()
    expect(source.read(entry!)).toBe('export const A=()=> <button/>')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('revision hashing streams large untracked files and detects tail edits', () => {
  const repo = repository()
  try {
    const file = path.join(repo, 'large.bin')
    const bytes = Buffer.alloc(3 * 1024 * 1024)
    writeFileSync(file, bytes)
    const before = workingTreeRevision(repo)
    bytes[bytes.length - 1] = 1
    writeFileSync(file, bytes)
    expect(workingTreeRevision(repo)).not.toBe(before)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('working-tree source indexes oversized product files without loading them for parsing', () => {
  const repo = repository()
  try {
    const file = 'apps/sim/components/large.tsx'
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), Buffer.alloc(3 * 1024 * 1024, 65))
    const source = new GitSource(repo, 'HEAD', true)
    const entry = source.entries.find((item) => item.path === file)
    expect(entry?.bytes).toBe(3 * 1024 * 1024)
    expect(() => source.read(entry!)).toThrow('Source exceeds the 2 MiB parsing limit')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('a tracked product source replaced by a FIFO fails before opening it', () => {
  const repo = repository()
  try {
    const file = 'apps/sim/components/example.tsx'
    mkdirSync(path.join(repo, 'apps/sim/components'), { recursive: true })
    writeFileSync(path.join(repo, file), 'export const A=()=> <p/>')
    execFileSync('git', ['add', file], { cwd: repo })
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'source'],
      { cwd: repo }
    )
    rmSync(path.join(repo, file))
    execFileSync('mkfifo', [path.join(repo, file)])
    expect(() => new GitSource(repo, 'HEAD', true)).toThrow('Unsupported working-tree source type')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
test('an unrelated untracked FIFO does not prevent inspecting the checkout', () => {
  const repo = repository()
  try {
    execFileSync('mkfifo', [path.join(repo, 'scratch.pipe')])
    expect(() => new GitSource(repo, 'HEAD', true)).not.toThrow()
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
