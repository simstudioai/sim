#!/usr/bin/env bun
/**
 * Asserts two properties of tracked source text that no linter covers.
 *
 * No raw `U+0000`. Git classifies a file as binary the moment its contents hold
 * a NUL byte, so a single stray `U+0000` written as a literal turns the whole
 * file into `Bin 0 -> 4102 bytes` in every diff — a reviewer sees not one line
 * of it, and `git grep`, formatters, and editors treat it as opaque or silently
 * normalize the byte away. `apps/sim/lib/api/server/nul-byte-boundary.test.ts`
 * shipped exactly that way, and two older files had done the same unnoticed.
 * The escape `'\u0000'` produces an identical string at runtime, so this costs
 * nothing to satisfy. `.gitattributes` forces source files to diff as text as a
 * second layer, which makes a violation visible; this audit is what keeps one
 * from landing in the first place.
 *
 * No `next/script` carrying a non-JavaScript `type` (JSON-LD, `application/json`,
 * a template) in `apps/**`. `next/script` loads and executes JavaScript: its
 * default `afterInteractive` strategy renders nothing on the server and injects
 * the tag from an effect, and `beforeInteractive` pushes it onto the
 * `self.__next_s` client queue, so the data never appears in the served HTML
 * that crawlers read. The docs JSON-LD shipped that way twice. Data belongs in a
 * native `<script type='application/ld+json'>` whose payload escapes `<`
 * (`serializeJsonLd`), as Next's JSON-LD guide prescribes.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

/** Extensions whose contents are source text a human reads in review. */
const SOURCE_EXTENSIONS = [
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
  '*.json',
  '*.md',
  '*.mdx',
  '*.css',
  '*.yml',
  '*.yaml',
  '*.toml',
  '*.sql',
  '*.sh',
]

/** `type` values `next/script` exists to load; `text/partytown` is its `worker` strategy. */
const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'text/partytown',
])

const NEXT_SCRIPT_IMPORT = /import\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]next\/script['"]/
const TYPE_ATTRIBUTE =
  /\btype\s*=\s*(?:'([^']*)'|"([^"]*)"|\{\s*(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)\s*\})/

/** The attribute text of the JSX opening tag that starts at `start`, skipping `>` inside braces. */
function openingTagAttributes(source: string, start: number): string {
  let depth = 0
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) return source.slice(start, index)
  }
  return source.slice(start)
}

/** Line numbers of `next/script` elements in `source` whose `type` is not JavaScript. */
function findDataNextScripts(source: string): number[] {
  const localName = NEXT_SCRIPT_IMPORT.exec(source)?.[1]
  if (!localName) return []
  const lines: number[] = []
  for (const match of source.matchAll(new RegExp(`<${localName}\\b`, 'g'))) {
    const attributes = openingTagAttributes(source, match.index + match[0].length)
    const typeMatch = TYPE_ATTRIBUTE.exec(attributes)
    if (!typeMatch) continue
    const type = typeMatch.slice(1).find((value) => value !== undefined) ?? ''
    if (EXECUTABLE_SCRIPT_TYPES.has(type.trim().toLowerCase())) continue
    lines.push(source.slice(0, match.index).split('\n').length)
  }
  return lines
}

const listed = spawnSync('git', ['ls-files', '-z', '--', ...SOURCE_EXTENSIONS], {
  cwd: ROOT,
  encoding: 'buffer',
  maxBuffer: 256 * 1024 * 1024,
})

if (listed.status !== 0) {
  console.error(`Source-text audit failed: \`git ls-files\` exited ${listed.status}.`)
  process.exit(1)
}

const files = listed.stdout
  .toString('utf8')
  .split('\0')
  .filter((entry) => entry.length > 0)

const nulOffenders: string[] = []
const dataScriptOffenders: string[] = []
for (const file of files) {
  const source = Bun.file(path.join(ROOT, file))
  if (!(await source.exists())) continue
  const bytes = await source.bytes()
  if (bytes.includes(0)) nulOffenders.push(file)
  if (file.startsWith('apps/') && /\.[jt]sx$/.test(file)) {
    const text = new TextDecoder().decode(bytes)
    if (!text.includes('next/script')) continue
    for (const line of findDataNextScripts(text)) dataScriptOffenders.push(`${file}:${line}`)
  }
}

if (nulOffenders.length > 0) {
  console.error(
    `Source-text audit failed: ${nulOffenders.length} tracked source file(s) contain a raw NUL byte,\n` +
      'which makes git treat them as binary and hides their contents from review.\n\n' +
      nulOffenders.map((file) => `  ${file}`).join('\n') +
      "\n\n  Write the character as the escape '\\u0000' instead — the runtime string is identical.\n"
  )
}

if (dataScriptOffenders.length > 0) {
  console.error(
    `Source-text audit failed: ${dataScriptOffenders.length} \`next/script\` element(s) carry a non-JavaScript \`type\`,\n` +
      'which next/script never writes into the server HTML, so crawlers never see the data.\n\n' +
      dataScriptOffenders.map((location) => `  ${location}`).join('\n') +
      "\n\n  Render a native <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />\n" +
      '  instead, as apps/docs/components/structured-data.tsx does.\n'
  )
}

if (nulOffenders.length > 0 || dataScriptOffenders.length > 0) process.exit(1)

console.log(
  `Source-text audit passed (${files.length} files, no raw NUL bytes, no data-typed next/script).`
)
