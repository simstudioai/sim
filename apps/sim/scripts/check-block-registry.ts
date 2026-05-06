#!/usr/bin/env bun

/**
 * CI check: enforces block-registry invariants that protect the runtime.
 *
 * Two checks run in sequence:
 *
 * 1. **Subblock ID stability** — diffs the current registry against a base ref
 *    and fails if any subblock ID was removed without a corresponding entry in
 *    `SUBBLOCK_ID_MIGRATIONS`. Removing IDs without a migration breaks
 *    deployed workflows.
 *
 * 2. **Canonical-id contract** — for every (block, tool) pair where the tool
 *    param is `required: true` and `visibility: 'user-only'`, the block must
 *    expose a subBlock whose `id` or `canonicalParamId` equals the tool param
 *    id. The serializer's pre-execution validator depends on this contract to
 *    resolve values via direct lookup; mismatches false-flag fields as missing
 *    at submit time.
 *
 * Usage:
 *   bun run apps/sim/scripts/check-block-registry.ts [base-ref]
 *
 * `base-ref` defaults to `HEAD~1`. In a PR CI pipeline, pass the merge base:
 *   bun run apps/sim/scripts/check-block-registry.ts origin/main
 */

import { execSync } from 'child_process'
import { SUBBLOCK_ID_MIGRATIONS } from '@/lib/workflows/migrations/subblock-migrations'
import { getAllBlocks } from '@/blocks/registry'
import { tools as toolRegistry } from '@/tools/registry'

const baseRef = process.argv[2] || 'HEAD~1'

const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
const gitOpts = { encoding: 'utf-8' as const, cwd: gitRoot }

type IdMap = Record<string, Set<string>>

/**
 * Extracts subblock IDs from the `subBlocks: [ ... ]` section of a block
 * definition. Only grabs the top-level `id:` of each subblock object —
 * ignores nested IDs inside `options`, `columns`, etc.
 */
function extractSubBlockIds(source: string): string[] {
  const startIdx = source.indexOf('subBlocks:')
  if (startIdx === -1) return []

  const bracketStart = source.indexOf('[', startIdx)
  if (bracketStart === -1) return []

  const ids: string[] = []
  let braceDepth = 0
  let bracketDepth = 0
  let i = bracketStart + 1
  bracketDepth = 1

  while (i < source.length && bracketDepth > 0) {
    const ch = source[i]

    if (ch === '[') bracketDepth++
    else if (ch === ']') {
      bracketDepth--
      if (bracketDepth === 0) break
    } else if (ch === '{') {
      braceDepth++
      if (braceDepth === 1) {
        const ahead = source.slice(i, i + 200)
        const idMatch = ahead.match(/{\s*(?:\/\/[^\n]*\n\s*)*id:\s*['"]([^'"]+)['"]/)
        if (idMatch) {
          ids.push(idMatch[1])
        }
      }
    } else if (ch === '}') {
      braceDepth--
    }

    i++
  }

  return ids
}

function getCurrentIds(): IdMap {
  const map: IdMap = {}
  for (const block of getAllBlocks()) {
    map[block.type] = new Set(block.subBlocks.map((sb) => sb.id))
  }
  return map
}

type PreviousIdsResult =
  | { kind: 'skip'; reason: string }
  | { kind: 'noop' }
  | { kind: 'ok'; map: IdMap }

function getPreviousIds(): PreviousIdsResult {
  const registryPath = 'apps/sim/blocks/registry.ts'
  const blocksDir = 'apps/sim/blocks/blocks'

  let hasChanges = false
  try {
    const diff = execSync(
      `git diff --name-only ${baseRef} HEAD -- ${registryPath} ${blocksDir}`,
      gitOpts
    ).trim()
    hasChanges = diff.length > 0
  } catch {
    return { kind: 'skip', reason: 'Could not diff against base ref' }
  }

  if (!hasChanges) {
    return { kind: 'noop' }
  }

  const map: IdMap = {}

  try {
    const blockFiles = execSync(`git ls-tree -r --name-only ${baseRef} -- ${blocksDir}`, gitOpts)
      .trim()
      .split('\n')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

    for (const filePath of blockFiles) {
      let content: string
      try {
        content = execSync(`git show ${baseRef}:${filePath}`, gitOpts)
      } catch {
        continue
      }

      const typeMatch = content.match(/BlockConfig\s*=\s*\{[\s\S]*?type:\s*['"]([^'"]+)['"]/)
      if (!typeMatch) continue
      const blockType = typeMatch[1]

      const ids = extractSubBlockIds(content)
      if (ids.length === 0) continue

      map[blockType] = new Set(ids)
    }
  } catch (err) {
    return { kind: 'skip', reason: `Could not read previous block files from ${baseRef}: ${err}` }
  }

  return { kind: 'ok', map }
}

type CheckResult =
  | { kind: 'pass'; message: string }
  | { kind: 'skip'; message: string }
  | { kind: 'fail'; errors: string[] }

function checkSubblockIdStability(): CheckResult {
  const previous = getPreviousIds()

  if (previous.kind === 'skip') {
    return { kind: 'skip', message: `${previous.reason} — skipping subblock ID stability check` }
  }
  if (previous.kind === 'noop') {
    return {
      kind: 'skip',
      message: 'No block definition changes detected — skipping subblock ID stability check',
    }
  }

  const current = getCurrentIds()
  const errors: string[] = []

  for (const [blockType, prevIds] of Object.entries(previous.map)) {
    const currIds = current[blockType]
    if (!currIds) continue

    const migrations = SUBBLOCK_ID_MIGRATIONS[blockType] ?? {}

    for (const oldId of prevIds) {
      if (currIds.has(oldId)) continue
      if (oldId in migrations) continue

      errors.push(
        `Block "${blockType}": subblock ID "${oldId}" was removed.\n` +
          `  → Add a migration in SUBBLOCK_ID_MIGRATIONS (lib/workflows/migrations/subblock-migrations.ts)\n` +
          `    mapping "${oldId}" to its replacement ID.`
      )
    }
  }

  if (errors.length === 0) {
    return { kind: 'pass', message: 'Subblock ID stability check passed' }
  }
  return { kind: 'fail', errors }
}

function checkCanonicalIdContract(): CheckResult {
  const errors: string[] = []

  for (const block of getAllBlocks()) {
    const access: string[] = block.tools?.access ?? []
    if (access.length === 0) continue

    // A subBlock with `canonicalParamId` has its raw `id` deleted from `params` during
    // canonical-group resolution in `extractParams` (serializer/index.ts), so the raw id is
    // NOT a valid lookup key at execution time — only the canonical is. Tool params must
    // align with the canonical, not the raw id.
    const subBlockKeys = new Set<string>()
    for (const sb of block.subBlocks ?? []) {
      const canonical = (sb as { canonicalParamId?: string }).canonicalParamId
      if (canonical) {
        subBlockKeys.add(canonical)
      } else if (sb.id) {
        subBlockKeys.add(sb.id)
      }
    }

    for (const toolId of access) {
      const tool = toolRegistry[toolId]
      if (!tool) continue

      for (const [paramId, paramConfig] of Object.entries(tool.params ?? {})) {
        if (!paramConfig || typeof paramConfig !== 'object') continue
        const required = (paramConfig as { required?: boolean }).required === true
        const userOnly = (paramConfig as { visibility?: string }).visibility === 'user-only'
        if (!required || !userOnly) continue

        if (!subBlockKeys.has(paramId)) {
          errors.push(
            `Block "${block.type}" → tool "${toolId}": required user-only param "${paramId}" has no subBlock with id or canonicalParamId === "${paramId}".\n` +
              '  → Rename a subBlock id or canonicalParamId to match the tool param id,\n' +
              "    and update the block's inputs + tools.config.params mapper to read from that key."
          )
        }
      }
    }
  }

  if (errors.length === 0) {
    return { kind: 'pass', message: 'Canonical-id contract check passed' }
  }
  return { kind: 'fail', errors }
}

function reportResult(label: string, failureHeader: string, result: CheckResult): boolean {
  if (result.kind === 'pass') {
    console.log(`✓ ${result.message}`)
    return true
  }
  if (result.kind === 'skip') {
    console.log(`⚠ ${result.message}`)
    return true
  }
  console.error(`\n✗ ${label} FAILED\n`)
  if (failureHeader) console.error(`${failureHeader}\n`)
  for (const err of result.errors) {
    console.error(`  ${err}\n`)
  }
  return false
}

const stabilityResult = checkSubblockIdStability()
const canonicalResult = checkCanonicalIdContract()

const stabilityOk = reportResult(
  'Subblock ID stability check',
  'Removing subblock IDs breaks deployed workflows.\nEither revert the rename or add a migration entry.',
  stabilityResult
)

const canonicalOk = reportResult(
  'Canonical-id contract check',
  "Misaligned ids cause the serializer's pre-execution validator to false-flag fields as missing at submit time.",
  canonicalResult
)

process.exit(stabilityOk && canonicalOk ? 0 : 1)
