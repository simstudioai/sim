/**
 * Where a source directory came from in git, for the audit log of the apply that sends it: the
 * commit checked out (`HEAD`) and the `origin` remote, read with the `git` binary. Best effort: a
 * directory outside a repository, a missing `git`, or an embedded host (no local checkout) sends
 * neither, and the apply goes ahead.
 */
import { execFile } from 'node:child_process'
import { embedStore } from '../../embed-context'

/** How long one `git` call may take before the apply goes ahead without it. */
const GIT_TIMEOUT_MS = 2_000

/** The longest repository URL the server records. */
const MAX_REPO_LENGTH = 512

/** What an apply's `provenance` carries about git, each field only when read. */
export interface GitProvenance {
  gitSha?: string
  repo?: string
}

/** `git <args>` run in `dir`, trimmed; `null` when it fails or finds nothing. */
function git(dir: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, ...args],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        const out = error ? '' : String(stdout).trim()
        resolve(out === '' ? null : out)
      }
    )
  })
}

/**
 * A remote URL with its credentials, query and fragment dropped (`https://token@host/x` →
 * `https://host/x`); an scp-style address (`git@host:org/repo.git`) carries none and is kept.
 * `null` for one too long to record, or another address the server would refuse as carrying
 * credentials: whitespace or a control character (a local path with a space), a query or
 * fragment, a `scheme:/` form with a user, or a user with a password.
 */
function sanitizedRepoUrl(remote: string): string | null {
  let repo = remote
  if (!remote.includes('://')) {
    if (
      /[?#\s\p{Cc}]/u.test(remote) ||
      /^[a-z][a-z0-9+.-]*:\/*[^/@]*@/i.test(remote) ||
      /^[^@/]*:[^@/]*@/.test(remote)
    ) {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    try {
      const url = new URL(remote)
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      repo = url.toString()
    } catch {
      return null
    }
  }
  return repo.length > 0 && repo.length <= MAX_REPO_LENGTH ? repo : null
}

/** The git commit and remote of `dir`, as far as they can be read. */
export async function gitProvenance(dir: string): Promise<GitProvenance> {
  if (embedStore.getStore()) return {}
  const [head, remote] = await Promise.all([
    git(dir, ['rev-parse', 'HEAD']),
    git(dir, ['config', '--get', 'remote.origin.url']),
  ])
  const repo = remote ? sanitizedRepoUrl(remote) : null
  return {
    ...(head && /^[0-9a-f]{40,64}$/.test(head) ? { gitSha: head } : {}),
    ...(repo ? { repo } : {}),
  }
}
