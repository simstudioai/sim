#!/usr/bin/env bun

/**
 * Compares top-level trigger output keys with keys returned from the provider's formatInput.
 *
 * Many trigger files import `buildTriggerSubBlocks` from `@/triggers`, which pulls the full
 * registry and is unsafe to load from a standalone script. This runner uses **per-provider
 * entry points** (utils + handler only) where implemented.
 *
 * Usage (from repo root):
 *   bun run apps/sim/scripts/check-trigger-alignment.ts <provider>
 *
 * Or from apps/sim:
 *   bun run scripts/check-trigger-alignment.ts <provider>
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://127.0.0.1:5432/__sim_trigger_alignment_check_placeholder__'
}

import type { TriggerOutput } from '@/triggers/types'

type CheckFn = () => Promise<{
  referenceLabel: string
  outputKeys: string[]
  formatInputKeys: string[]
}>

const PROVIDER_CHECKS: Record<string, CheckFn> = {
  gong: async () => {
    const { buildCallOutputs } = await import('@/triggers/gong/utils')
    const { gongHandler } = await import('@/lib/webhooks/providers/gong')
    const outputs = buildCallOutputs() as Record<string, TriggerOutput>
    const result = await gongHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {},
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildCallOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
}

const provider = process.argv[2]?.trim()
if (!provider) {
  console.error('Usage: bun run apps/sim/scripts/check-trigger-alignment.ts <provider>')
  process.exit(1)
}

const run = PROVIDER_CHECKS[provider]
if (!run) {
  console.log(
    `[${provider}] No bundled alignment check yet. Add an entry to PROVIDER_CHECKS in apps/sim/scripts/check-trigger-alignment.ts (import utils + handler only, not @/triggers/registry), or compare output keys manually.`
  )
  process.exit(0)
}

const { referenceLabel, outputKeys, formatInputKeys } = await run()
const missingInInput = outputKeys.filter((k) => !formatInputKeys.includes(k))
const extraInInput = formatInputKeys.filter((k) => !outputKeys.includes(k))

console.log(`Provider: ${provider}`)
console.log(`Reference: ${referenceLabel}`)
console.log('outputs (top-level):', outputKeys.join(', ') || '(none)')
console.log('formatInput keys:', formatInputKeys.join(', ') || '(none)')

if (missingInInput.length > 0) {
  console.error('MISSING in formatInput:', missingInInput.join(', '))
}
if (extraInInput.length > 0) {
  console.warn('EXTRA in formatInput (not in outputs):', extraInInput.join(', '))
}

if (missingInInput.length > 0) {
  process.exit(1)
}

console.log(`\n[${provider}] Alignment check passed.`)
process.exit(0)
