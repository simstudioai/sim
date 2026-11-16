#!/usr/bin/env bun
/**
 * Keeps `apps/sim/blocks/sdk-names.json` add-only against a base ref.
 *
 * A builder name is public API the moment a workflow file uses it (`slack.sendMessage(...)`), so
 * once a namespace, method, trigger builder or param alias reaches the base branch it may never
 * change or disappear. `check:sdk-names` proves the file covers the registry; it cannot see a
 * rename, because the renamed file is just as complete. This check compares the working-tree file
 * with the one at the merge-base and fails on any base entry that is missing or different. New
 * entries pass. A base that has no file yet means everything is new.
 *
 * Usage:
 *   bun run scripts/check-sdk-names-frozen.ts [baseRef]   # base defaults to origin/staging
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'

const ROOT = path.resolve(import.meta.dirname, '..')
const NAMES_PATH = 'apps/sim/blocks/sdk-names.json'

/** The maps under a block entry whose every key is frozen once it reaches the base. */
const NAME_MAPS = ['methods', 'triggers'] as const

function record(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined
}

function compareMap(
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  where: string,
  out: string[]
) {
  for (const key of Object.keys(base).sort(compareStrings)) {
    const was = base[key]
    const now = own(head, key)
    if (now === undefined) out.push(`${where}.${key} ("${String(was)}") was removed`)
    else if (now !== was)
      out.push(`${where}.${key} was renamed "${String(was)}" → "${String(now)}"`)
  }
}

/**
 * Every base name the head drops or changes, one line each. `base` is `null` when the base ref
 * has no sdk-names file, which makes every head entry new.
 */
export function frozenNameViolations(base: unknown, head: unknown): string[] {
  if (base === null) return []
  const out: string[] = []
  const baseBlocks = record(record(base).blocks)
  const headBlocks = record(record(head).blocks)
  for (const type of Object.keys(baseBlocks).sort(compareStrings)) {
    const was = record(baseBlocks[type])
    const nowValue = own(headBlocks, type)
    if (!isRecordLike(nowValue)) {
      out.push(`${type} (namespace "${String(was.namespace)}") was removed`)
      continue
    }
    if (nowValue.namespace !== was.namespace) {
      out.push(
        `${type}.namespace was renamed "${String(was.namespace)}" → "${String(nowValue.namespace)}"`
      )
    }
    for (const map of NAME_MAPS) {
      compareMap(record(was[map]), record(own(nowValue, map)), `${type}.${map}`, out)
    }
    const baseParams = record(was.params)
    const headParams = record(own(nowValue, 'params'))
    for (const surface of Object.keys(baseParams).sort(compareStrings)) {
      compareMap(
        record(baseParams[surface]),
        record(own(headParams, surface)),
        `${type}.params.${surface}`,
        out
      )
    }
  }
  return out
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * The base file's JSON, `null` when the base has no file, or throws when the ref is unusable. The
 * merge-base is preferred; a shallow CI fetch that has no merge-base compares against the ref.
 */
function readBase(baseRef: string): unknown {
  const mergeBase =
    git(['merge-base', baseRef, 'HEAD'])?.trim() ||
    git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])?.trim()
  if (!mergeBase) {
    throw new Error(`Cannot resolve '${baseRef}'. Fetch it before running this check.`)
  }
  if (git(['cat-file', '-e', `${mergeBase}:${NAMES_PATH}`]) === null) return null
  const text = git(['show', `${mergeBase}:${NAMES_PATH}`])
  if (text === null) throw new Error(`Cannot read ${NAMES_PATH} at ${mergeBase}.`)
  return JSON.parse(text)
}

if (import.meta.main) {
  const baseRef = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'origin/staging'
  let base: unknown
  try {
    base = readBase(baseRef)
  } catch (error) {
    console.error(`✗ sdk-names freeze check could not run.\n  ${getErrorMessage(error)}`)
    process.exit(1)
  }
  const head: unknown = JSON.parse(readFileSync(path.join(ROOT, NAMES_PATH), 'utf8'))
  const violations = frozenNameViolations(base, head)
  if (violations.length > 0) {
    console.error(
      `✗ ${NAMES_PATH} changed or removed ${violations.length} name(s) that ${baseRef} already ships. Names are add-only: restore each one, and give a colliding NEW entry a hand-picked name instead.\n`
    )
    for (const violation of violations) console.error(`  ${violation}`)
    process.exit(1)
  }
  console.log(
    base === null
      ? `✓ ${baseRef} has no ${NAMES_PATH}; every name is new.`
      : `✓ ${NAMES_PATH} keeps every name ${baseRef} ships.`
  )
}
