/**
 * i18n codemod (locate + splice) for Sim client components.
 *
 * For each `'use client'` .tsx file it:
 *   1. parses with the TypeScript compiler API (TSX-aware),
 *   2. finds user-facing strings — JSX text + whitelisted string attributes,
 *   3. generates stable keys under the `auto` namespace,
 *   4. splices `t('auto.key')` in (text edits on the ORIGINAL source — formatting preserved),
 *   5. inserts `const t = useTranslations()` + the next-intl import,
 *   6. appends new keys (English source) to messages/en/auto.json.
 *
 * Safety: only touches client components; skips strings without letters, ALL_CAPS
 * consts, className/style/key/href/src/id attributes; does a no-op if a file has
 * no extractable strings. Run type-check after each batch.
 *
 * Usage:
 *   bun run scripts/i18n-migrate/extract.ts <glob-or-dir> [--write] [--limit N]
 *   (dry-run by default; --write applies edits)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EN_AUTO = join(ROOT, 'apps', 'sim', 'messages', 'en', 'auto.json')

const TARGET_ATTRS = new Set([
  'placeholder',
  'title',
  'label',
  'aria-label',
  'ariaLabel',
  'alt',
  'tooltip',
  'description',
  'emptyMessage',
  'helperText',
  'hint',
])

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const limitIdx = argv.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity
const targetPath = argv.find((a) => !a.startsWith('--') && a !== String(LIMIT)) || 'apps/sim/app'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      walk(p, out)
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      out.push(p)
    }
  }
  return out
}

/** Slug → key fragment. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('_')
    .slice(0, 48)
}

function hasLetters(s: string): boolean {
  return /[a-zA-Z]/.test(s)
}

/** A JSX text worth translating: has letters, not just an expression/number. */
function isTranslatableText(raw: string): boolean {
  const t = raw.trim()
  if (!t || !hasLetters(t)) return false
  if (/^[A-Z0-9_]+$/.test(t)) return false // constant-like
  if (t.length < 2) return false
  return true
}

interface Edit {
  start: number
  end: number
  replacement: string
  key: string
  text: string
}

function processFile(file: string): { changed: boolean; keys: Record<string, string> } {
  const src = readFileSync(file, 'utf-8')
  if (!/^['"]use client['"]/m.test(src)) return { changed: false, keys: {} } // client only
  if (src.includes('useTranslations(')) return { changed: false, keys: {} } // already migrated

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: Edit[] = []
  const keys: Record<string, string> = {}
  const used = new Set<string>()

  // Pick a hook variable name that isn't already bound in the file (avoids the
  // `{ toast: t }` collision). Also find where imports end (AST, not regex) so we
  // never splice into a multi-line import.
  let tIsTaken = false
  let lastImportEnd = -1
  const scan = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) lastImportEnd = Math.max(lastImportEnd, node.getEnd())
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 't'
    ) {
      tIsTaken = true
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === 't') {
      tIsTaken = true
    }
    ts.forEachChild(node, scan)
  }
  scan(sf)
  const tname = tIsTaken ? 'tI18n' : 't'

  const makeKey = (text: string) => {
    let base = slug(text) || 'label'
    let k = base
    let n = 2
    while (used.has(k) && keys[k] !== text) k = `${base}_${n++}`
    used.add(k)
    keys[k] = text
    return k
  }

  const visit = (node: ts.Node) => {
    // JSX text
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf)
      if (isTranslatableText(raw)) {
        const lead = raw.length - raw.trimStart().length
        const trail = raw.length - raw.trimEnd().length
        const text = raw.trim()
        const key = makeKey(text)
        const start = node.getStart(sf) + lead
        const end = node.getEnd() - trail
        edits.push({ start, end, replacement: `{${tname}('${key}')}`, key, text })
      }
    }
    // Whitelisted string attributes: attr="..."
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf)
      const val = node.initializer.text
      if (TARGET_ATTRS.has(name) && isTranslatableText(val)) {
        const key = makeKey(val)
        edits.push({
          start: node.initializer.getStart(sf),
          end: node.initializer.getEnd(),
          replacement: `{${tname}('${key}')}`,
          key,
          text: val,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length === 0) return { changed: false, keys: {} }

  // Apply edits end→start so offsets stay valid.
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)

  // Add the next-intl import after the last COMPLETE import (AST offset on the
  // original source). The JSX edits above all sit after the imports, so they
  // never shifted any offset <= lastImportEnd — the splice point stays valid.
  if (!/from ['"]next-intl['"]/.test(out) && lastImportEnd > 0) {
    out = `${out.slice(0, lastImportEnd)}\nimport { useTranslations } from 'next-intl'${out.slice(lastImportEnd)}`
  }

  // Insert the hook into each component function that returns JSX.
  out = insertHooks(out, tname)

  if (WRITE) writeFileSync(file, out, 'utf-8')
  return { changed: true, keys }
}

/**
 * Insert `const t = useTranslations('auto')` at the top of each React COMPONENT
 * function whose block body contains a spliced `t('...')` call and no existing
 * `const t`. Nested handlers/closures reuse that `t` via closure — we never insert
 * into them (which would also break the rules of hooks).
 *
 * Recognized component shapes:
 *  - `function Component() {}` / `export default function [Name]() {}`
 *  - `const Component = (props) => {}` / `= function () {}` (PascalCase)
 *  - `export default () => {}` / `export default <expr>`
 *  - `memo(...)` / `forwardRef(...)` / `observer(...)` wrapping an arrow/function
 */
function insertHooks(code: string, tname: string): string {
  const sf = ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const inserts: number[] = []
  const isPascal = (name: string | undefined) => !!name && /^[A-Z]/.test(name)
  const WRAPPERS = new Set(['memo', 'forwardRef', 'observer'])
  const callRe = new RegExp(`\\b${tname}\\('`)
  const declRe = new RegExp(`\\bconst\\s+${tname}\\s*=\\s*useTranslations\\(`)

  const considerBody = (body: ts.Node | undefined) => {
    if (!body || !ts.isBlock(body)) return
    const text = body.getText(sf)
    if (!callRe.test(text)) return
    if (declRe.test(text)) return
    inserts.push(body.getStart(sf) + 1) // just after '{'
  }

  const considerFn = (node: ts.Node | undefined) => {
    if (!node) return
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      considerBody(node.body)
    }
  }

  const visit = (node: ts.Node) => {
    const isDefaultExport =
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword || m.kind === ts.SyntaxKind.ExportKeyword)

    // function Component() {}  /  export default function [Name]() {}
    if (ts.isFunctionDeclaration(node) && (isPascal(node.name?.getText(sf)) || isDefaultExport)) {
      considerBody(node.body)
    }
    // const Component = (...) => {} / = function () {}
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isPascal(decl.name.getText(sf))) {
          // direct arrow/fn, or wrapped in memo/forwardRef/observer
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            const callee = decl.initializer.expression.getText(sf)
            if (WRAPPERS.has(callee.split('.').pop() || '')) considerFn(decl.initializer.arguments[0])
          } else {
            considerFn(decl.initializer)
          }
        }
      }
    }
    // export default () => {} / export default memo(() => {}) / export default <expr>
    if (ts.isExportAssignment(node)) {
      const e = node.expression
      if (ts.isCallExpression(e) && WRAPPERS.has((e.expression.getText(sf).split('.').pop() || ''))) {
        considerFn(e.arguments[0])
      } else {
        considerFn(e)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  inserts.sort((a, b) => b - a)
  let out = code
  for (const at of inserts) out = `${out.slice(0, at)}\n  const ${tname} = useTranslations('auto')${out.slice(at)}`
  return out
}

// ---- run ----
const MANIFEST = join(ROOT, 'scripts', 'i18n-migrate', 'manifest.json')
const abs = join(ROOT, targetPath)
const files = (existsSync(abs) && statSync(abs).isDirectory() ? walk(abs) : [abs]).slice(0, LIMIT)
let changed = 0
const allKeys: Record<string, string> = {}
const manifest: Record<string, Record<string, string>> = {}
for (const f of files) {
  const r = processFile(f)
  if (r.changed) {
    changed++
    Object.assign(allKeys, r.keys)
    manifest[f.replace(`${ROOT}/`, '')] = r.keys
    console.log(
      `${WRITE ? 'WROTE' : 'would change'}: ${f.replace(`${ROOT}/`, '')} (+${Object.keys(r.keys).length} keys)`
    )
  }
}

if (WRITE && Object.keys(allKeys).length) {
  const existing = existsSync(EN_AUTO) ? JSON.parse(readFileSync(EN_AUTO, 'utf-8')) : {}
  writeFileSync(EN_AUTO, `${JSON.stringify({ ...existing, ...allKeys }, null, 2)}\n`, 'utf-8')
  const prevManifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf-8')) : {}
  writeFileSync(MANIFEST, `${JSON.stringify({ ...prevManifest, ...manifest }, null, 2)}\n`, 'utf-8')
}

console.log(`\n[i18n-migrate] files=${files.length} changed=${changed} newKeys=${Object.keys(allKeys).length} write=${WRITE}`)
