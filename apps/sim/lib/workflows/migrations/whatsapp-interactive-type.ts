import { createLogger } from '@sim/logger'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WhatsAppInteractiveTypeMigration')

const WHATSAPP_BLOCK_TYPE = 'whatsapp'
const INTERACTIVE_TYPE_ID = 'interactiveType'
const SEND_INTERACTIVE_OPERATION = 'send_interactive'

/**
 * A stored subblock value counts as configured when the user put something in it —
 * either a JSON array with entries or a raw string (which may be an unresolved
 * `<block.output>` reference, so it must not be JSON-parsed to be recognized).
 * An empty array literal is what the editor leaves behind after clearing a field,
 * so it reads as unconfigured.
 */
function isConfigured(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed !== '[]'
}

/**
 * Backfills `interactiveType` on WhatsApp `send_interactive` blocks saved before that
 * discriminator existed.
 *
 * `buttons` and `sections` are now gated on `interactiveType`, but subblock defaults are
 * only seeded when a block is first added to a workflow — never backfilled onto saved
 * state. So a pre-existing block carries no value, both conditions evaluate false, and the
 * serializer drops the configured payload: the tool then fails with "Provide either buttons
 * (reply buttons) or sections (list)". Worse, opening such a block in the editor lets the
 * dropdown seed `button` (it writes its default whenever the stored value is empty), which
 * silently hides a list block's sections. This runs at load — ahead of that seeding, and
 * across both live and deployed state — so the stored payload decides the variant instead.
 *
 * Precedence mirrors the tool's own `buttons ? 'button' : 'list'`: a block that somehow has
 * both configured (which the tool rejected then and now) resolves to `button`.
 */
export function backfillWhatsAppInteractiveType(blocks: Record<string, BlockState>): {
  blocks: Record<string, BlockState>
  migrated: boolean
} {
  const subBlockType = getBlock(WHATSAPP_BLOCK_TYPE)?.subBlocks?.find(
    (config) => config.id === INTERACTIVE_TYPE_ID
  )?.type

  if (!subBlockType) return { blocks, migrated: false }

  let anyMigrated = false
  const result: Record<string, BlockState> = {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const subBlocks = block.subBlocks
    if (
      block.type !== WHATSAPP_BLOCK_TYPE ||
      !subBlocks ||
      subBlocks.operation?.value !== SEND_INTERACTIVE_OPERATION ||
      isConfigured(subBlocks[INTERACTIVE_TYPE_ID]?.value)
    ) {
      result[blockId] = block
      continue
    }

    const resolved =
      isConfigured(subBlocks.sections?.value) && !isConfigured(subBlocks.buttons?.value)
        ? 'list'
        : 'button'

    anyMigrated = true
    result[blockId] = {
      ...block,
      subBlocks: {
        ...subBlocks,
        [INTERACTIVE_TYPE_ID]: {
          id: INTERACTIVE_TYPE_ID,
          type: subBlockType,
          value: resolved,
        },
      },
    }

    logger.info('Backfilled WhatsApp interactiveType', {
      blockId: block.id,
      interactiveType: resolved,
    })
  }

  return { blocks: result, migrated: anyMigrated }
}
