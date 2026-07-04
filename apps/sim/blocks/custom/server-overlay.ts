import { AsyncLocalStorage } from 'node:async_hooks'
import type { WorkflowInputField } from '@/lib/workflows/input-format'
import { buildCustomBlockConfig, type CustomBlockRow } from '@/blocks/custom/build-config'
import { registerBlockOverlayResolver } from '@/blocks/custom/overlay'
import type { BlockConfig, BlockIcon } from '@/blocks/types'

/** A row for the overlay, optionally carrying live-derived Start input fields. */
type CustomBlockOverlayRow = CustomBlockRow & { inputFields?: WorkflowInputField[] }

/**
 * Server-side custom-block overlay. Resolves `custom_block_*` types during
 * serialization + execution from a per-request, per-org map held in
 * AsyncLocalStorage — keeping the `@/blocks/registry` accessors synchronous while
 * isolating concurrent requests across different organizations.
 */

/** Icon is never rendered server-side (the serializer ignores it). */
const PLACEHOLDER_ICON: BlockIcon = () => null as never

const store = new AsyncLocalStorage<Map<string, BlockConfig>>()

registerBlockOverlayResolver({
  get: (type) => store.getStore()?.get(type),
  all: () => [...(store.getStore()?.values() ?? [])],
})

/**
 * Run `fn` with the given org's custom blocks resolvable via `getBlock`/
 * `getAllBlocks`. Wrap every execution serializer entry point (execute route,
 * trigger.dev task, scheduled/webhook runs) at the org-context boundary so a
 * workflow containing a custom block can serialize and execute.
 *
 * Execution passes bare rows: `inputMapping` is schema-agnostic, so no per-field
 * editors are needed. Agent-facing callers (`get_blocks_metadata`, `edit_workflow`)
 * pass rows carrying `inputFields` so `getBlock` exposes the real input sub-blocks —
 * matching what the VFS block files show — instead of an empty schema.
 */
export function withCustomBlockOverlay<T>(
  rows: CustomBlockOverlayRow[],
  fn: () => Promise<T>
): Promise<T> {
  const map = new Map<string, BlockConfig>()
  for (const row of rows) {
    map.set(
      row.type,
      buildCustomBlockConfig(row, row.inputFields ?? [], { icon: PLACEHOLDER_ICON })
    )
  }
  return store.run(map, fn)
}
