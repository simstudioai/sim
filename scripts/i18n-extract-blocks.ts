/**
 * i18n extractor for block / connector / tool DEFINITIONS (`.ts`).
 *
 * Unlike the .tsx codemod, these files are plain serialized objects with no React
 * hook to host, so we don't rewrite them. We only COLLECT their user-facing
 * strings (block name/description/longDescription + subblock title/placeholder/
 * description/hint + option labels) into messages/en/blocks.json, keyed by
 * `blockI18nKey`. The UI translates them at render time via the same key.
 *
 * Usage:
 *   bun run scripts/i18n-extract-blocks.ts            # dry-run (prints counts)
 *   bun run scripts/i18n-extract-blocks.ts --write    # write messages/en/blocks.json
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { blockI18nKey } from '../apps/sim/lib/i18n/block-key'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EN_BLOCKS = join(ROOT, 'apps', 'sim', 'messages', 'en', 'blocks.json')
const WRITE = process.argv.includes('--write')

/** Object-property names whose string value is shown to the user. */
const TARGET_PROPS = new Set([
  'name',
  'description',
  'longDescription',
  'title',
  'placeholder',
  'hint',
  'subtitle',
  'tooltip',
])

const SCAN_DIRS = [
  join(ROOT, 'apps', 'sim', 'blocks', 'blocks'),
  join(ROOT, 'apps', 'sim', 'blocks', 'triggers'),
]

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      walk(p, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p)
    }
  }
  return out
}

function hasLetters(s: string): boolean {
  return /[a-zA-Z]/.test(s)
}

/** Only real UI phrases — rejects ids, urls, css, enums, ALL_CAPS, single lower tokens. */
function isUiText(raw: string): boolean {
  const t = raw.trim()
  if (t.length < 2 || !hasLetters(t)) return false
  if (/^[A-Z0-9_]+$/.test(t)) return false
  if (/^https?:\/\//i.test(t)) return false
  if (/^[./#@]/.test(t)) return false
  if (/[<>]/.test(t)) return false
  if (/\s/.test(t)) return true
  if (/^[a-z0-9]+([-_:.][a-z0-9]+)+$/i.test(t)) return false
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false
  if (/^[A-Z][a-zA-Z]+$/.test(t)) return true
  return false
}

function collect(file: string, keys: Record<string, string>): number {
  const src = readFileSync(file, 'utf-8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let n = 0
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const propName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : undefined
      const init = node.initializer
      const value =
        init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
          ? init.text
          : undefined
      if (propName && TARGET_PROPS.has(propName) && value && isUiText(value)) {
        const key = blockI18nKey(value)
        if (key && !(key in keys)) {
          keys[key] = value
          n++
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

const files = SCAN_DIRS.flatMap((d) => walk(d))
const keys: Record<string, string> = {}
let total = 0
for (const f of files) total += collect(f, keys)

console.log(`[i18n-blocks] scanned ${files.length} files → ${Object.keys(keys).length} unique strings`)

if (WRITE) {
  writeFileSync(EN_BLOCKS, `${JSON.stringify(keys, null, 2)}\n`, 'utf-8')
  console.log(`[i18n-blocks] wrote ${EN_BLOCKS}`)
} else {
  console.log('[i18n-blocks] dry-run (pass --write to save). Sample:')
  for (const [k, v] of Object.entries(keys).slice(0, 10)) console.log(`  ${k}: ${v}`)
}
