#!/usr/bin/env bun
/**
 * Audits brand icons that render "bare" (without their colored tile) for
 * theme-safety. The suggested-actions surface and other bare contexts draw a
 * block's icon on a neutral page in both light and dark mode. An icon whose
 * SVG hardcodes only near-white fills vanishes on a light page; one that
 * hardcodes only near-black fills vanishes on a dark page. The fix is to draw
 * monochrome marks with `fill='currentColor'` (which adapts via the
 * theme-aware foreground) and reserve hardcoded fills for genuinely
 * multi-color brand logos.
 *
 * Scope: blocks that contribute suggested-action prompt rows — i.e. blocks
 * whose meta defines `templates`. New integrations land here, so this is where
 * regressions are caught. Multi-color icons and `currentColor` icons pass.
 *
 * Each block's main `icon:` AND every template's own `icon:` is audited (a
 * template may reuse another block's brand icon). Only icons imported from
 * `@/components/icons` are checked — that is the only module this script can
 * resolve; `@sim/emcn/icons` are design-system line icons drawn with
 * `currentColor` and are safe by construction, so they are intentionally
 * skipped.
 *
 * Limitation: this catches purely-monochrome icons (only near-white or only
 * near-black fills). It cannot catch an icon whose large primary shape is
 * white but which also has a small vivid accent (the accent clears the
 * heuristic) — that needs a visual light+dark check. Always eyeball new icons
 * on the suggested-actions surface in both themes.
 *
 * Run: `bun run scripts/check-bare-icons.ts`
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { perceivedBrightness } from '../apps/sim/lib/colors'

const ROOT = path.resolve(import.meta.dir, '..')
const BLOCKS_DIR = path.join(ROOT, 'apps/sim/blocks/blocks')
const ICONS_FILE = path.join(ROOT, 'apps/sim/components/icons.tsx')

const isNearWhite = (c: string) => {
  const b = perceivedBrightness(c)
  return b !== null && b > 0.9
}
const isNearBlack = (c: string) => {
  const b = perceivedBrightness(c)
  return b !== null && b < 0.1
}

/** Extract each exported icon's source body, keyed by component name. */
function indexIconBodies(src: string): Map<string, string> {
  const bodies = new Map<string, string>()
  const starts: Array<{ name: string; index: number }> = []
  for (const m of src.matchAll(/export (?:function|const) (\w+)\s*[=(]/g)) {
    starts.push({ name: m[1], index: m.index })
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length
    bodies.set(starts[i].name, src.slice(starts[i].index, end))
  }
  return bodies
}

interface Hazard {
  block: string
  icon: string
  kind: 'light' | 'dark'
  detail: string
}

function analyzeIcon(body: string): { hazard: 'light' | 'dark' | null; detail: string } {
  if (/currentColor/.test(body)) return { hazard: null, detail: 'uses currentColor' }
  if (/url\(#|<stop|inearGradient|adialGradient/.test(body))
    return { hazard: null, detail: 'gradient fill' }
  const colors: string[] = []
  for (const m of body.matchAll(/(?:fill|stroke)=(?:'([^']*)'|"([^"]*)")/g)) {
    const v = (m[1] ?? m[2] ?? '').trim()
    if (v && v.toLowerCase() !== 'none') colors.push(v)
  }
  const literal = colors.filter((c) => c.toLowerCase() !== 'currentcolor')
  if (literal.length === 0) return { hazard: null, detail: 'no literal fills' }
  const vivid = literal.filter((c) => !isNearWhite(c) && !isNearBlack(c))
  if (vivid.length > 0) return { hazard: null, detail: `multi-color (${vivid[0]})` }
  if (literal.every(isNearWhite))
    return { hazard: 'light', detail: `only near-white fills (${literal.join(', ')})` }
  if (literal.every(isNearBlack))
    return { hazard: 'dark', detail: `only near-black fills (${literal.join(', ')})` }
  return { hazard: null, detail: 'mixed' }
}

async function main() {
  const iconsSrc = await readFile(ICONS_FILE, 'utf8')
  const iconBodies = indexIconBodies(iconsSrc)

  const blockFiles = (await readdir(BLOCKS_DIR)).filter((f) => f.endsWith('.ts'))
  const hazards: Hazard[] = []
  const seen = new Set<string>()

  for (const file of blockFiles) {
    const src = await readFile(path.join(BLOCKS_DIR, file), 'utf8')
    if (!/\btemplates:\s*\[/.test(src)) continue

    const brandIcons = new Set<string>()
    for (const m of src.matchAll(
      /import\s*(?:type\s*)?{([^}]*)}\s*from\s*'@\/components\/icons'/g
    )) {
      for (const name of m[1].split(',')) {
        const trimmed = name.trim()
        if (trimmed) brandIcons.add(trimmed)
      }
    }

    for (const m of src.matchAll(/\bicon:\s*(\w+)/g)) {
      const iconName = m[1]
      if (!brandIcons.has(iconName)) continue
      const key = `${file}:${iconName}`
      if (seen.has(key)) continue
      seen.add(key)
      const body = iconBodies.get(iconName)
      if (!body) continue
      const { hazard, detail } = analyzeIcon(body)
      if (hazard) {
        hazards.push({ block: file.replace('.ts', ''), icon: iconName, kind: hazard, detail })
      }
    }
  }

  if (hazards.length === 0) {
    console.log('✓ All suggested-action brand icons render safely bare in light and dark mode.')
    process.exit(0)
  }

  console.error(`\nFound ${hazards.length} bare-icon hazard(s):\n`)
  for (const h of hazards) {
    const mode = h.kind === 'light' ? 'invisible on LIGHT pages' : 'invisible on DARK pages'
    console.error(`  ${h.block}  (${h.icon}) — ${mode}`)
    console.error(`    ${h.detail}`)
    console.error(
      `    Fix: draw the monochrome shape with fill='currentColor' in components/icons.tsx`
    )
    console.error(
      `    so it adapts to the theme bare and to the tile foreground (getTileIconColorClass).\n`
    )
  }
  process.exit(1)
}

main()
