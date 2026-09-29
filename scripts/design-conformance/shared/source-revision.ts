import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Identity of HEAD, tracked edits, and nonignored new files in a local checkout. */
export function workingTreeRevision(repo: string): string {
  const git = (args: string[], maxBuffer?: number) =>
    execFileSync('git', args, { cwd: repo, ...(maxBuffer ? { maxBuffer } : {}) })
  const head = git(['rev-parse', 'HEAD']).toString().trim()
  const diff = git(['diff', '--binary', 'HEAD'], 64 * 1024 * 1024)
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  const digest = createHash('sha256').update(head).update(diff)
  for (const file of untracked) digest.update(file).update(readFileSync(path.join(repo, file)))
  return digest.digest('hex')
}
