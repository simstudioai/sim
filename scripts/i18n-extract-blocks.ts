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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { blockI18nKey } from '../apps/sim/lib/i18n/block-key'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EN_DIR = join(ROOT, 'apps', 'sim', 'messages', 'en')
const EN_BLOCKS_DIR = join(EN_DIR, 'blocks')
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

/** Per-block catalogs, keyed by the source file's basename (gmail.ts → "gmail"). */
const perBlock: Record<string, Record<string, string>> = {}
let total = 0
for (const f of files) {
  const name = basename(f).replace(/\.ts$/, '')
  const keys: Record<string, string> = perBlock[name] ?? {}
  total += collect(f, keys)
  if (Object.keys(keys).length > 0) perBlock[name] = keys
}

const blockNames = Object.keys(perBlock).sort()
const allKeys = new Set(blockNames.flatMap((n) => Object.keys(perBlock[n])))
console.log(
  `[i18n-blocks] scanned ${files.length} files → ${blockNames.length} non-empty block catalogs, ${allKeys.size} unique strings`
)

if (WRITE) {
  mkdirSync(EN_BLOCKS_DIR, { recursive: true })
  // Remove a stale monolithic blocks.json (replaced by the per-block directory).
  const monolith = join(EN_DIR, 'blocks.json')
  if (existsSync(monolith)) rmSync(monolith)
  for (const name of blockNames) {
    const sorted = Object.fromEntries(Object.entries(perBlock[name]).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(join(EN_BLOCKS_DIR, `${name}.json`), `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8')
  }
  // Index of block files, consumed by the i18n loader to merge the namespace.
  writeFileSync(join(EN_BLOCKS_DIR, '_index.json'), `${JSON.stringify(blockNames, null, 2)}\n`, 'utf-8')
  console.log(`[i18n-blocks] wrote ${blockNames.length} files + _index.json to ${EN_BLOCKS_DIR}`)
} else {
  console.log('[i18n-blocks] dry-run (pass --write to save). Sample blocks:')
  for (const name of blockNames.slice(0, 8)) console.log(`  ${name}.json (${Object.keys(perBlock[name]).length} strings)`)
}
