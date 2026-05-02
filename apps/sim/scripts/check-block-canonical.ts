#!/usr/bin/env bun

/**
 * CI check: enforce the canonical-id contract that the serializer's
 * pre-execution validator relies on.
 *
 * For every (block, tool) pair where the tool param is `required: true` and
 * `visibility: 'user-only'`, the block must expose a subBlock whose `id` or
 * `canonicalParamId` equals the tool param id. Otherwise the validator
 * resolves the value under the wrong key and false-flags the field as missing
 * at submit time.
 *
 * Historically this was patched at runtime by invoking `tools.config.params`
 * inside try/catch during validation. That swallowed mapper throws on
 * placeholder values and degraded validation accuracy. This audit lifts the
 * contract into config so the validator can stay pure.
 *
 * Usage:
 *   bun run apps/sim/scripts/check-block-canonical.ts
 */

import { getAllBlocks } from '@/blocks/registry'
import { tools as toolRegistry } from '@/tools/registry'

type Violation = {
  blockType: string
  toolId: string
  paramId: string
}

const violations: Violation[] = []

for (const block of getAllBlocks()) {
  const access: string[] = block.tools?.access ?? []
  if (access.length === 0) continue

  const subBlockKeys = new Set<string>()
  for (const sb of block.subBlocks ?? []) {
    if (sb.id) subBlockKeys.add(sb.id)
    const canonical = (sb as { canonicalParamId?: string }).canonicalParamId
    if (canonical) subBlockKeys.add(canonical)
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
        violations.push({ blockType: block.type, toolId, paramId })
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`\nFound ${violations.length} block/tool canonical-id mismatch(es):\n`)
  for (const v of violations) {
    console.error(
      `  - block '${v.blockType}' → tool '${v.toolId}': required user-only param '${v.paramId}' has no subBlock with id or canonicalParamId === '${v.paramId}'`
    )
  }
  console.error(
    "\nFix: rename the relevant subBlock id or canonicalParamId to match the tool param id,\n     and update the block's inputs + tools.config.params mapper to read from that key.\n"
  )
  process.exit(1)
}

console.log('check:block-canonical — no violations.')
