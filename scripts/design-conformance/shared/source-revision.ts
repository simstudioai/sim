import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, openSync, readlinkSync, readSync } from 'node:fs'
import path from 'node:path'

/** Identity of HEAD, tracked edits, and nonignored new files in a local checkout. */
export function workingTreeRevision(repo: string): string {
  const git = (args: string[], maxBuffer?: number) => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) env[key] = undefined
    return execFileSync('git', args, {
      cwd: repo,
      ...(maxBuffer ? { maxBuffer } : {}),
      env,
    })
  }
  const head = git(['rev-parse', 'HEAD']).toString().trim()
  const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD'], 64 * 1024 * 1024)
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  const digest = createHash('sha256').update(head).update(diff)
  for (const file of untracked) {
    const absolute = path.join(repo, file)
    const stat = lstatSync(absolute)
    const kind = stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : 'other'
    const link = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : undefined
    const size = link?.length ?? (stat.isFile() ? stat.size : 0)
    digest
      .update(`\0${kind}\0${Buffer.byteLength(file)}:`)
      .update(file)
      .update(`${size}:`)
    if (link) digest.update(link)
    else if (stat.isFile()) {
      const handle = openSync(absolute, 'r')
      const chunk = Buffer.allocUnsafe(64 * 1024)
      try {
        for (let read = 0; read < size; ) {
          const count = readSync(handle, chunk, 0, Math.min(chunk.length, size - read), null)
          if (count === 0) throw new Error(`Untracked file changed while hashing: ${file}`)
          digest.update(chunk.subarray(0, count))
          read += count
        }
      } finally {
        closeSync(handle)
      }
    }
  }
  return digest.digest('hex')
}
