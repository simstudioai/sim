import { execFileSync } from 'node:child_process'

export interface Entry {
  path: string
  oid: string
  mode: string
  size: number
}
export interface Change {
  before?: string
  after?: string
  status: string
}

/** Git arguments are passed directly, without a shell or worktree filters. */
export class GitReader {
  constructor(readonly cwd: string) {}

  run(args: string[], input?: string): Buffer {
    try {
      return execFileSync('git', ['--no-pager', ...args], {
        cwd: this.cwd,
        input,
        maxBuffer: 300 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1' },
      })
    } catch {
      throw new Error(`Git operation failed: ${args[0]}`)
    }
  }

  commit(ref: string): string {
    const result = this.run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
      .toString()
      .trim()
    if (!/^[a-f0-9]{40,64}$/.test(result)) throw new Error('Invalid resolved commit')
    return result
  }

  compare(baseRef: string, headRef: string) {
    if (this.run(['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') {
      throw new Error('Complete Git history is required')
    }
    const base = this.commit(baseRef)
    const head = this.commit(headRef)
    const bases = this.run(['merge-base', '--all', base, head]).toString().trim().split('\n')
    if (bases.length !== 1 || !/^[a-f0-9]{40,64}$/.test(bases[0])) {
      throw new Error('A unique merge-base is required; fetch complete history')
    }
    return { base, head, mergeBase: bases[0] }
  }

  tree(commit: string): Map<string, Entry> {
    const entries = new Map<string, Entry>()
    for (const record of this.run(['ls-tree', '-rlz', commit]).toString().split('\0')) {
      if (!record) continue
      const tab = record.indexOf('\t')
      const [mode, type, oid, size] = record.slice(0, tab).trim().split(/\s+/)
      if (type !== 'blob') continue
      const path = record.slice(tab + 1)
      entries.set(path, { path, mode, oid, size: Number(size) })
    }
    return entries
  }

  changes(base: string, head: string): Change[] {
    const records = this.run([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--name-status',
      '-z',
      '-M',
      base,
      head,
      '--',
    ])
      .toString()
      .split('\0')
    const changes: Change[] = []
    for (let i = 0; i < records.length - 1; ) {
      const status = records[i++]
      const path = records[i++]
      if (status.startsWith('R') || status.startsWith('C')) {
        changes.push({ status, before: path, after: records[i++] })
      } else {
        changes.push({
          status,
          before: status === 'A' ? undefined : path,
          after: status === 'D' ? undefined : path,
        })
      }
    }
    return changes
  }

  /** Reads blobs by object ID. Batch framing is byte-based, including binary blobs. */
  blobs(entries: Entry[]): Map<string, string> {
    const result = new Map<string, string>()
    for (let start = 0; start < entries.length; start += 500) {
      const batch = entries.slice(start, start + 500)
      const output = this.run(
        ['cat-file', '--batch'],
        `${batch.map((entry) => entry.oid).join('\n')}\n`
      )
      let offset = 0
      for (const entry of batch) {
        const end = output.indexOf(10, offset)
        const [oid, type, bytes] = output.subarray(offset, end).toString().split(' ')
        const size = Number(bytes)
        if (oid !== entry.oid || type !== 'blob' || size !== entry.size)
          throw new Error('Unreadable Git blob')
        offset = end + 1
        result.set(entry.path, output.subarray(offset, offset + size).toString('utf8'))
        offset += size + 1
      }
    }
    return result
  }
}
