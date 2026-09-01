#!/usr/bin/env bun
/**
 * Audits that every BYOK provider is wired through all four places it must appear.
 *
 * A hosted tool names its provider once, in `hosting.byokProviderId`, but that id
 * has to be registered in three other files before the feature actually works:
 *
 *   tools/types.ts                     the `BYOKProviderId` union tools compile against
 *   lib/api/contracts/byok-keys.ts     the zod enum the byok-keys route validates against
 *   settings/.../byok.tsx `PROVIDERS`  the row the settings page renders
 *   settings/.../byok.tsx `SECTIONS`   the section that row is grouped under
 *
 * Only the first is enforced by the compiler. The other three fail *silently*:
 *
 * - Missing from `PROVIDERS`, the settings page has no row, so a workspace can
 *   never bring its own key and is stuck on the hosted key.
 * - Missing from `PROVIDER_SECTIONS`, the row exists but the sectioned renderer
 *   (`byok-key-manager.tsx` filters `providers` by `section.ids.includes(p.id)`)
 *   drops it, so the page looks correct in source and renders nothing.
 * - Drifted between the two `BYOKProviderId` declarations, a tool can name a
 *   provider the route then rejects at runtime.
 *
 * None of those produce a type error, a test failure, or a log line — which is
 * exactly why they need an audit rather than a convention.
 *
 * Run: `bun run check:byok-providers`
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tools } from '../apps/sim/tools/registry'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = resolve(ROOT, 'apps/sim')
const TOOL_TYPES = resolve(APP, 'tools/types.ts')
const CONTRACT = resolve(APP, 'lib/api/contracts/byok-keys.ts')
const SETTINGS = resolve(APP, 'app/workspace/[workspaceId]/settings/components/byok/byok.tsx')

/** Path as written in an error message, relative to the repo root. */
function rel(absolute: string): string {
  return absolute.slice(ROOT.length + 1)
}

/**
 * Returns the source between the brackets opened by the first match of `start`.
 *
 * Bracket-counting rather than a lazy regex: every one of these blocks nests
 * (an object per provider, an array per section), so `[\s\S]*?\]` would stop at
 * the first inner close.
 */
function blockAfter(source: string, start: RegExp, open: '[' | '{'): string {
  const match = source.match(start)
  if (match?.index === undefined) {
    throw new Error(`could not locate ${start} — has the declaration been renamed?`)
  }
  const close = open === '[' ? ']' : '}'
  const from = source.indexOf(open, match.index + match[0].length - 1)
  if (from === -1) throw new Error(`no ${open} after ${start}`)

  let depth = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return source.slice(from + 1, i)
    }
  }
  throw new Error(`unbalanced ${open} after ${start}`)
}

/** Every single-quoted string literal in a chunk of source, in order. */
function quoted(source: string): string[] {
  return [...source.matchAll(/'([a-z0-9_-]+)'/gi)].map((m) => m[1])
}

interface Failure {
  file: string
  message: string
  items: string[]
  fix: string
}

async function main() {
  const [toolTypesSrc, contractSrc, settingsSrc] = await Promise.all([
    readFile(TOOL_TYPES, 'utf8'),
    readFile(CONTRACT, 'utf8'),
    readFile(SETTINGS, 'utf8'),
  ])

  const unionDecl = toolTypesSrc.match(/export type BYOKProviderId =([\s\S]*?)\n\n/)
  if (!unionDecl) throw new Error(`could not locate BYOKProviderId union in ${rel(TOOL_TYPES)}`)
  const union = new Set(quoted(unionDecl[1]))

  const schema = new Set(quoted(blockAfter(contractSrc, /byokProviderIdSchema = z\.enum\(/, '[')))

  const settingsProviders = new Set(
    [
      ...blockAfter(settingsSrc, /const PROVIDERS[^=]*=/, '[').matchAll(
        /\bid:\s*'([a-z0-9_-]+)'/gi
      ),
    ].map((m) => m[1])
  )

  const sectioned = new Set(
    [
      ...blockAfter(settingsSrc, /const PROVIDER_SECTIONS[^=]*=/, '[').matchAll(
        /\bids:\s*\[([\s\S]*?)\]/g
      ),
    ].flatMap((m) => quoted(m[1]))
  )

  /** Provider id -> the hosted tools that name it. */
  const hostedBy = new Map<string, string[]>()
  for (const [toolId, tool] of Object.entries(tools)) {
    const provider = tool.hosting?.byokProviderId
    if (!provider) continue
    const existing = hostedBy.get(provider)
    if (existing) existing.push(toolId)
    else hostedBy.set(provider, [toolId])
  }

  const failures: Failure[] = []
  const describe = (provider: string) => {
    const owners = hostedBy.get(provider) ?? []
    return owners.length > 0
      ? `${provider} (${owners[0]}${owners.length > 1 ? ', …' : ''})`
      : provider
  }

  const missingFromSchema = [...hostedBy.keys()].filter((p) => !schema.has(p)).sort()
  if (missingFromSchema.length > 0) {
    failures.push({
      file: rel(CONTRACT),
      message: 'hosted tools name a provider the byok-keys route would reject',
      items: missingFromSchema.map(describe),
      fix: 'add the id to byokProviderIdSchema',
    })
  }

  const missingFromSettings = [...hostedBy.keys()]
    .filter((p) => schema.has(p) && !settingsProviders.has(p))
    .sort()
  if (missingFromSettings.length > 0) {
    failures.push({
      file: rel(SETTINGS),
      message:
        'hosted tools name a provider with no settings row, so a workspace cannot bring its own key',
      items: missingFromSettings.map(describe),
      fix: 'add an entry to PROVIDERS',
    })
  }

  const unsectioned = [...settingsProviders].filter((p) => !sectioned.has(p)).sort()
  if (unsectioned.length > 0) {
    failures.push({
      file: rel(SETTINGS),
      message: 'PROVIDERS entries the sectioned renderer drops, so their row never appears',
      items: unsectioned,
      fix: 'add the id to the right PROVIDER_SECTIONS section',
    })
  }

  const orphanedSections = [...sectioned].filter((p) => !settingsProviders.has(p)).sort()
  if (orphanedSections.length > 0) {
    failures.push({
      file: rel(SETTINGS),
      message: 'PROVIDER_SECTIONS lists ids with no matching PROVIDERS entry',
      items: orphanedSections,
      fix: 'remove the stale id, or add the missing PROVIDERS entry',
    })
  }

  const unionOnly = [...union].filter((p) => !schema.has(p)).sort()
  const schemaOnly = [...schema].filter((p) => !union.has(p)).sort()
  if (unionOnly.length > 0 || schemaOnly.length > 0) {
    failures.push({
      file: `${rel(TOOL_TYPES)} vs ${rel(CONTRACT)}`,
      message: 'the two BYOKProviderId declarations have drifted',
      items: [
        ...unionOnly.map((p) => `${p} (union only)`),
        ...schemaOnly.map((p) => `${p} (zod enum only)`),
      ],
      fix: 'keep the union and the zod enum listing the same ids',
    })
  }

  if (failures.length > 0) {
    console.error('\n❌ BYOK provider wiring is incomplete\n')
    for (const failure of failures) {
      console.error(`  ${failure.file}: ${failure.message}`)
      for (const item of failure.items) console.error(`    - ${item}`)
      console.error(`    fix: ${failure.fix}\n`)
    }
    process.exit(1)
  }

  console.log(
    `✓ BYOK provider wiring is complete (${hostedBy.size} hosted providers, ${settingsProviders.size} settings rows)`
  )
}

main().catch((error) => {
  console.error(`\n❌ check-byok-providers failed: ${error.message}`)
  process.exit(1)
})
