#!/usr/bin/env bun
/**
 * Flags example UUIDs in the published OpenAPI specs that do not look deliberately synthetic.
 *
 * The specs in `apps/docs/` ship in a public repository, so an example id copied from a real run
 * publishes an opaque workspace, workflow, or execution identifier. The repo's hand-crafted
 * placeholders are pandigital — every hex digit appears, none more than three times
 * (`3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36`) — a texture a real v4 UUID essentially never has.
 * That gives a mechanical signature for "this was generated, not authored".
 *
 * The directory is globbed rather than read from `OPENAPI_SPEC_FILES`, because the gap this closes
 * is precisely that `openapi-core.json` is absent from that manifest and from every other check.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const SPEC_DIR = path.join(ROOT, 'apps/docs')
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Ids that are obviously synthetic to a reader but do not match the pandigital texture. */
const ALLOWED: Record<string, string> = {
  '7c9e6679-7425-40de-944b-e07fc1f90ae7': "Wikipedia's canonical example UUID",
  'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77':
    'pre-existing hand-authored block id shared with the v2 workflow operations tests',
}

/**
 * All-zero and all-f sentinels read as synthetic on sight.
 *
 * Takes an already-lowercased id: hex is case-insensitive, so counting `A` and `a` as two
 * digits would inflate the distinct count and misjudge the texture.
 */
function isSentinel(uuid: string): boolean {
  return new Set(uuid.replace(/-/g, '')).size <= 2
}

/**
 * Hand-authored placeholders in this repo use every hex digit, none more than three times.
 *
 * Takes an already-lowercased id, for the reason given on {@link isSentinel}.
 */
function isHouseStyle(uuid: string): boolean {
  const hex = uuid.replace(/-/g, '')
  const digits = new Set(hex)
  if (digits.size < 16) return false
  return [...digits].every((digit) => hex.split(digit).length - 1 <= 3)
}

const specFiles = readdirSync(SPEC_DIR)
  .filter((file) => file.startsWith('openapi') && file.endsWith('.json'))
  .sort()

const findings: string[] = []

for (const file of specFiles) {
  const contents = await Bun.file(path.join(SPEC_DIR, file)).text()
  const seen = new Set(contents.match(UUID_PATTERN) ?? [])
  for (const uuid of [...seen].sort()) {
    const normalized = uuid.toLowerCase()
    if (normalized in ALLOWED || isSentinel(normalized) || isHouseStyle(normalized)) continue
    findings.push(`  - ${file}: ${uuid}`)
  }
}

if (findings.length > 0) {
  console.error(
    `Published OpenAPI specs contain example UUIDs that look real rather than hand-authored:\n${findings.join('\n')}\n` +
      'Replace each with a placeholder using every hex digit at most three times, or add it to ALLOWED with a reason.'
  )
  process.exit(1)
}

console.log(
  `Spec example ids passed: ${specFiles.length} published specs contain no real-looking UUIDs.`
)
