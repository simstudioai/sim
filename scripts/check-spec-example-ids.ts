#!/usr/bin/env bun
/**
 * Gates the example UUIDs published in the OpenAPI specs against an explicit approved set.
 *
 * The specs in `apps/docs/` ship in a public repository, so an example id copied from a real run
 * publishes an opaque workspace, workflow, or execution identifier. This check exists because that
 * has already happened: six such ids sat in `openapi-core.json` until they were replaced.
 *
 * The gate is enumeration, not inference. An earlier revision instead scored the *texture* of an
 * id — the repo's hand-authored placeholders are pandigital, using every hex digit no more than
 * three times, which a real v4 UUID was assumed never to be. Measured against 12M generated v4
 * UUIDs, 0.81% of them have exactly that texture: roughly one copied id in 124 would have passed
 * and shipped. Tightening the rule does not rescue it — requiring every digit exactly twice drops
 * the random pass rate to 0 in 20M, but also rejects all fourteen placeholders in use today, so it
 * is the same cost as changing every id. Enumeration reaches zero false negatives for the price of
 * one line per id, and the ids are few: eighteen across eight specs, introduced by six commits in
 * two and a half months, because the specs deliberately share a handful of placeholders.
 *
 * Adding an endpoint whose example uses a new id therefore fails this check until the id is listed
 * below. That failure is the point — it is the moment a human confirms the id was authored rather
 * than pasted, and the diff line records the answer for the next reader.
 *
 * The directory is globbed rather than read from `OPENAPI_SPEC_FILES`, because the gap this closes
 * is precisely that `openapi-core.json` is absent from that manifest and from every other check.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const SPEC_DIR = path.join(ROOT, 'apps/docs')
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Every example UUID the specs are allowed to publish, with what it stands for.
 *
 * Sentinels are covered structurally by {@link isSentinel} and are not listed here.
 */
const APPROVED: Record<string, string> = {
  '0f7c1a2e-9b3d-4c58-8a21-6d4e5f7a9b01': 'run id in the RUN_ID_CONFLICT error example',
  '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36': 'the shared workflow id placeholder',
  '4c1f9e77-2b3a-4f8d-9e10-6a2c8d4b1e05': 'KNOWLEDGE_CHUNK_ID',
  '7c9e6679-7425-40de-944b-e07fc1f90ae7': "KNOWLEDGE_BASE_ID, Wikipedia's canonical example UUID",
  '9d3b7f10-2c8e-4a56-b0f4-6e1a8c5d2b97': 'pausedExecutionId on the paused-execution example',
  '9f4c2a10-3b7e-4d58-8f6a-2c1d0e5b7a94': 'second workspace id, where one example needs two',
  'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77':
    'minted block id, shared with the v2 workflow operations tests',
  'a6f0c8d2-3e57-4b19-8d4a-1c9e2f6b0a35': 'block id in the selected-outputs selector example',
  'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64': 'the shared workspace id placeholder',
  'b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12': 'KNOWLEDGE_DOCUMENT_ID',
  'b8c2e60f-1a47-4d35-9e8b-3f0d5a7c2e19': 'executionId on the failed-execution example',
  'c7a92e15-3f4b-4d8c-a1e6-9b0d5f2c8e74': 'executionId returned by the execute example',
  'd5e1a3c7-8f60-4b29-9c4d-2a6e0f8b3d17': 'executionId on the paused-execution example',
  'e4f8d2b6-9a1c-4e3d-8b7f-5c0a2d9e6f13': 'the shared run id placeholder',
  'f0b3d8c2-7e5a-4b9d-8c1f-6a4e2d0b9c58': 'executionId on the resume examples',
  'f1c3a7d0-4b52-4a8e-9f61-2d7c8b3e5a04': 'run output file id',
}

/**
 * All-zero and all-f sentinels read as synthetic on sight.
 *
 * Unlike a texture score this admits no real id even in principle: fewer than three distinct hex
 * digits across all 32 positions has probability on the order of 1e-27, so the family can be
 * covered by shape rather than enumerated one nil-UUID variant at a time.
 *
 * Takes an already-lowercased id: hex is case-insensitive, so counting `A` and `a` as two digits
 * would inflate the distinct count and admit ids this is meant to reject.
 */
function isSentinel(uuid: string): boolean {
  return new Set(uuid.replace(/-/g, '')).size <= 2
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
    if (normalized in APPROVED || isSentinel(normalized)) continue
    findings.push(`  - ${file}: ${uuid}`)
  }
}

if (findings.length > 0) {
  console.error(
    `Published OpenAPI specs contain example UUIDs that are not approved placeholders:\n${findings.join('\n')}\n` +
      'Prefer reusing an id already in APPROVED in scripts/check-spec-example-ids.ts. If the example ' +
      'genuinely needs its own, hand-author one in the house style — every hex digit, none more than ' +
      'three times — then add it to APPROVED with what it stands for. Never paste an id from a real run.'
  )
  process.exit(1)
}

console.log(
  `Spec example ids passed: ${specFiles.length} published specs publish only approved placeholders.`
)
