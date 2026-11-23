#!/usr/bin/env bun
/**
 * Keeps the frozen SDK names (`apps/sim/blocks/sdk-names/<type>.json`) add-only against a base ref.
 *
 * A builder name is public API the moment a workflow file uses it (`slack.sendMessage(...)`), so
 * once a namespace, method, trigger builder or param alias reaches the base branch it may never
 * change or disappear. `check:sdk-names` proves the file covers the registry; it cannot see a
 * rename, because the renamed file is just as complete. This check compares the working-tree files
 * with the ones at the merge-base and fails on any base entry that is missing or different. New
 * entries pass. A base that has no names yet means everything is new; a base from before the
 * per-block split is read from its single `sdk-names.json`.
 *
 * Usage:
 *   bun run scripts/check-sdk-names-frozen.ts [baseRef]   # base defaults to origin/staging
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'

const ROOT = path.resolve(import.meta.dirname, '..')
const NAMES_DIR = 'apps/sim/blocks/sdk-names'
/** The single file the names lived in before the per-block split. */
const LEGACY_NAMES_PATH = 'apps/sim/blocks/sdk-names.json'

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
 * has no SDK names, which makes every head entry new.
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
    const baseParams = record(was.paramAliases)
    const headParams = record(own(nowValue, 'paramAliases'))
    for (const surface of Object.keys(baseParams).sort(compareStrings)) {
      compareMap(
        record(baseParams[surface]),
        record(own(headParams, surface)),
        `${type}.paramAliases.${surface}`,
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

/** `{ blocks }` from per-block file texts keyed by path. */
function namesFromFiles(files: Iterable<[string, string]>): { blocks: Record<string, unknown> } {
  const blocks: Record<string, unknown> = {}
  for (const [file, text] of files) blocks[path.basename(file, '.json')] = JSON.parse(text)
  return { blocks }
}

/**
 * Every `.json` path under {@link NAMES_DIR} at `revision`, with its text, read in one
 * `git cat-file --batch` call rather than a process per block.
 */
function readTreeFiles(revision: string): Array<[string, string]> {
  const listing = git(['ls-tree', '-r', '--name-only', revision, '--', `${NAMES_DIR}/`])
  if (listing === null) throw new Error(`Cannot list ${NAMES_DIR} at ${revision}.`)
  const files = listing.split('\n').filter((file) => file.endsWith('.json'))
  if (files.length === 0) return []
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: ROOT,
    input: files.map((file) => `${revision}:${file}\n`).join(''),
    maxBuffer: 64 * 1024 * 1024,
  })
  let offset = 0
  return files.map((file) => {
    const headerEnd = output.indexOf(0x0a, offset)
    const [, type, size] = output.subarray(offset, headerEnd).toString('utf8').split(' ')
    if (type !== 'blob') throw new Error(`Cannot read ${file} at ${revision}.`)
    const start = headerEnd + 1
    offset = start + Number(size) + 1
    return [file, output.subarray(start, start + Number(size)).toString('utf8')]
  })
}

/**
 * The base names, `null` when the base has none, or throws when the ref is unusable. The
 * merge-base is preferred; a shallow CI fetch that has no merge-base compares against the ref.
 */
function readBase(baseRef: string): unknown {
  const mergeBase =
    git(['merge-base', baseRef, 'HEAD'])?.trim() ||
    git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])?.trim()
  if (!mergeBase) {
    throw new Error(`Cannot resolve '${baseRef}'. Fetch it before running this check.`)
  }
  const files = readTreeFiles(mergeBase)
  if (files.length > 0) return namesFromFiles(files)
  if (git(['cat-file', '-e', `${mergeBase}:${LEGACY_NAMES_PATH}`]) === null) return null
  const text = git(['show', `${mergeBase}:${LEGACY_NAMES_PATH}`])
  if (text === null) throw new Error(`Cannot read ${LEGACY_NAMES_PATH} at ${mergeBase}.`)
  return JSON.parse(text)
}

function readHead(): { blocks: Record<string, unknown> } {
  const dir = path.join(ROOT, NAMES_DIR)
  return namesFromFiles(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')])
  )
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
  const head = readHead()
  const violations = frozenNameViolations(base, head)
  if (violations.length > 0) {
    console.error(
      `✗ ${NAMES_DIR} changed or removed ${violations.length} name(s) that ${baseRef} already ships. Names are add-only: restore each one, and give a colliding NEW entry a hand-picked name instead.\n`
    )
    for (const violation of violations) console.error(`  ${violation}`)
    process.exit(1)
  }
  console.log(
    base === null
      ? `✓ ${baseRef} has no SDK names; every name is new.`
      : `✓ ${NAMES_DIR} keeps every name ${baseRef} ships.`
  )
}
