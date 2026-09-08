import type { ComponentType } from 'react'
import { Repeat, Split } from '@sim/emcn/icons'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

/** Maps legacy diagram names to the editor's canonical block types. */
export function normalizeBlockType(type: string, triggerMode = false): string {
  if (type === 'router') return 'router_v2'
  if (type === 'knowledge_base') return 'knowledge'
  if (type === 'webhook') return triggerMode ? 'generic_webhook' : 'webhook_request'
  return type
}

/** Registry-generated glyphs, plus the two containers that have no block config. */
export function resolveIcon(type: string): ComponentType<{ className?: string }> | null {
  if (type === 'loop') return Repeat
  if (type === 'parallel') return Split
  return blockTypeToIconMap[normalizeBlockType(type)] ?? null
}
