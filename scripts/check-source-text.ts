#!/usr/bin/env bun
/**
 * Asserts that no tracked source file contains a raw `U+0000`.
 *
 * Git classifies a file as binary the moment its contents hold a NUL byte, so a
 * single stray `U+0000` written as a literal turns the whole file into
 * `Bin 0 -> 4102 bytes` in every diff — a reviewer sees not one line of it, and
 * `git grep`, formatters, and editors treat it as opaque or silently normalize
 * the byte away. `apps/sim/lib/api/server/nul-byte-boundary.test.ts` shipped
 * exactly that way, and two older files had done the same unnoticed.
 *
 * The escape `'\u0000'` produces an identical string at runtime, so this costs
 * nothing to satisfy. `.gitattributes` forces source files to diff as text as a
 * second layer, which makes a violation visible; this audit is what keeps one
 * from landing in the first place.
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

const offenders: string[] = []
for (const file of files) {
  const source = Bun.file(path.join(ROOT, file))
  if (!(await source.exists())) continue
  const bytes = await source.bytes()
  if (bytes.includes(0)) offenders.push(file)
}

if (offenders.length > 0) {
  console.error(
    `Source-text audit failed: ${offenders.length} tracked source file(s) contain a raw NUL byte,\n` +
      'which makes git treat them as binary and hides their contents from review.\n\n' +
      offenders.map((file) => `  ${file}`).join('\n') +
      "\n\n  Write the character as the escape '\\u0000' instead — the runtime string is identical."
  )
  process.exit(1)
}

console.log(`Source-text audit passed (${files.length} files, no raw NUL bytes).`)
