import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Every tracked or untracked-but-not-ignored file under `root`, relative to it, sorted. A file
 * deleted from the working tree but still in the index is dropped. Audits list files this way so a
 * new file counts before it is staged and an ignored build output never does.
 */
export function listRepoFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter((file) => file && existsSync(path.join(root, file)))
    .sort()
}
