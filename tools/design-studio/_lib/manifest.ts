import 'server-only'

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { workingTreeRevision } from '#design-conformance/shared/source-revision'

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

export interface StudioFixture {
  type: string
  id: string
  variant?: { axis: string; value: string }
  sample?: StudioSample
  defaultState?: string
  requiredElement?: string
  action?: string
}

export interface StudioVariant {
  id: string
  axis: string
  value: string
  defaultValue?: string
  fixture: StudioFixture | null
  states: string[]
  status: 'ready' | 'needs-fixture'
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
  variants?: StudioVariant[]
  fixture: StudioFixture | null
  previewKind?: 'source-component' | 'source-style-sample' | 'indicative-sample'
  states?: string[]
  status: 'ready' | 'needs-fixture'
}

export interface StudioTreatment {
  key: string
  family: string
  title: string
  entries: StudioEntry[]
}

export interface StudioManifest {
  version: 3
  runId: string
  status: 'complete' | 'incomplete'
  identity: { commit: string; treeHash: string; scanner: unknown }
  sourceRevision: string
  fixtureHash: string
  components: StudioTreatment[]
  nonvisualExports: { name: string; source: StudioLocation; reason: string }[]
  extras: StudioTreatment[]
  coverageFailures: { file: string; reason: string }[]
  analysis?: {
    stylingUncheckedCount: number
    controlUncheckedCount: number
    stylingUncheckedSample: { file: string; line?: number; reason: string }[]
    controlUncheckedSample: { file: string; line?: number; reason: string }[]
    limitations: string[]
  }
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
    if (manifest.version !== 3 || manifest.runId !== latest.runId) return null
  } catch {
    return null
  }
  let stale = false
  try {
    const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.env.SIM_STUDIO_REPO ?? process.cwd(),
      encoding: 'utf8',
    }).trim()
    // This revision includes fixture adapters and contracts as well as product source.
    stale = workingTreeRevision(repo) !== manifest.sourceRevision
  } catch {
    stale = true
  }
  return {
    manifest: {
      ...manifest,
      components: mode === 'components' ? manifest.components : [],
      extras: mode === 'extras' ? manifest.extras : [],
    },
    stale,
  }
}
