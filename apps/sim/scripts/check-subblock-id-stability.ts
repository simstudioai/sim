#!/usr/bin/env bun

/**
 * CI check: detect subblock ID renames that would break deployed workflows.
 *
 * Compares the current block registry against the parent commit.
 * If any subblock ID was removed from a block, it must have a corresponding
 * entry in SUBBLOCK_ID_MIGRATIONS — otherwise this script exits non-zero.
 *
 * Usage:
 *   bun run apps/sim/scripts/check-subblock-id-stability.ts [base-ref]
 *
 * base-ref defaults to HEAD~1.  In a PR CI pipeline, pass the merge base:
 *   bun run apps/sim/scripts/check-subblock-id-stability.ts origin/main
 */

import { execSync } from 'child_process'
import { SUBBLOCK_ID_MIGRATIONS } from '@/lib/workflows/migrations/subblock-migrations'
import { getAllBlocks } from '@/blocks/registry'

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

function getPreviousIds(): IdMap {
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
    console.log('⚠ Could not diff against base ref — skipping check')
    process.exit(0)
  }

  if (!hasChanges) {
    console.log('✓ No block definition changes detected — nothing to check')
    process.exit(0)
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
    console.log(`⚠ Could not read previous block files from ${baseRef} — skipping check`, err)
    process.exit(0)
  }

  return map
}

const previous = getPreviousIds()
const current = getCurrentIds()
const errors: string[] = []

for (const [blockType, prevIds] of Object.entries(previous)) {
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

if (errors.length > 0) {
  console.error('✗ Subblock ID stability check FAILED\n')
  console.error(
    'Removing subblock IDs breaks deployed workflows.\n' +
      'Either revert the rename or add a migration entry.\n'
  )
  for (const err of errors) {
    console.error(`  ${err}\n`)
  }
  process.exit(1)
} else {
  console.log('✓ Subblock ID stability check passed')
  process.exit(0)
}
