import 'server-only'

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface StudioLocation {
  file: string
  line: number
  symbol?: string
  relationship?: string
}

export interface StudioSample {
  kind: 'control' | 'text' | 'surface' | 'swatch' | 'runtime'
  tag: string
  className: string
  values: string[]
  property: string
  value: string
}

export interface StudioEntry {
  id: string
  kind: 'component' | 'icon' | 'extra'
  name: string
  family: string
  source: StudioLocation
  usages: StudioLocation[]
  rationale?: string
  value?: string
  decision?: string
  signals?: { id: string; kind: string; source: StudioLocation; value?: string }[]
  variant?: { axis: string; value: string; defaultValue: string }
  fixture: {
    type: string
    id: string
    variant?: { axis: string; value: string }
    sample?: StudioSample
  } | null
  previewKind?: 'source-component' | 'source-style-sample' | 'indicative-sample'
  previewFingerprint?: string
  states?: string[]
  status: 'ready' | 'needs-fixture' | 'capture-failed' | 'pending-capture'
  images: Record<string, string>
  captureError?: string
}

export interface StudioManifest {
  version: 2
  runId: string
  status: 'complete' | 'incomplete'
  identity: { commit: string; treeHash: string; scanner: unknown }
  sourceRevision: string
  ledgerHash: string
  fixtureHash: string
  browser: string
  components: StudioEntry[]
  nonvisualExports: { name: string; source: StudioLocation; reason: string }[]
  extras: StudioEntry[]
  decisions: {
    stale: { fingerprint: string; status?: string; rationale?: string; evidence?: string }[]
    ambiguous: { fingerprint: string; status?: string; rationale?: string; evidence?: string }[]
  }
  coverageFailures: { file: string; reason: string }[]
  counts: { components: number; extras: number; missing: number }
}

export function studioOutputRoot() {
  return path.resolve(
    process.env.SIM_STUDIO_OUTPUT ?? path.join(homedir(), '.local/state/sim2/design-studio')
  )
}

/** Reads one page of a completed refresh publication; the page never launches a scan. */
export function getStudioPageManifest(mode: 'components' | 'extras'): {
  manifest: StudioManifest
  stale: boolean
  ledgerStale: boolean
} | null {
  let manifest: StudioManifest
  try {
    const pointer = path.join(studioOutputRoot(), 'latest.json')
    if (!existsSync(pointer)) return null
    const latest = JSON.parse(readFileSync(pointer, 'utf8')) as { runId?: unknown; path?: unknown }
    if (
      typeof latest.runId !== 'string' ||
      typeof latest.path !== 'string' ||
      !/^[0-9TZ-]+-[a-f0-9]{10}$/.test(latest.runId)
    ) {
      return null
    }
    const runDirectory = path.join(studioOutputRoot(), `run-${latest.runId}`)
    if (path.resolve(latest.path) !== runDirectory) return null
    manifest = JSON.parse(readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'))
    if (manifest.version !== 2 || manifest.runId !== latest.runId) return null
  } catch {
    return null
  }
  let stale = false
  try {
    const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.env.SIM_STUDIO_REPO ?? process.cwd(),
      encoding: 'utf8',
    }).trim()
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    const diff = execFileSync('git', ['diff', '--binary', 'HEAD'], {
      cwd: repo,
      maxBuffer: 64 * 1024 * 1024,
    })
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
      .sort()
    const digest = createHash('sha256').update(head).update(diff)
    for (const name of untracked) digest.update(name).update(readFileSync(path.join(repo, name)))
    stale = digest.digest('hex') !== manifest.sourceRevision
  } catch {
    stale = true
  }
  let ledgerStale = false
  if (process.env.SIM_STUDIO_LEDGER) {
    try {
      const ledger = path.resolve(process.env.SIM_STUDIO_LEDGER)
      ledgerStale =
        createHash('sha256').update(readFileSync(ledger)).digest('hex') !== manifest.ledgerHash
    } catch {
      ledgerStale = true
    }
  } else if (manifest.ledgerHash) {
    ledgerStale = true
  }
  return {
    manifest: {
      ...manifest,
      components: mode === 'components' ? manifest.components : [],
      extras: mode === 'extras' ? manifest.extras : [],
    },
    stale,
    ledgerStale,
  }
}
