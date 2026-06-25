import { createHash } from 'node:crypto'

/**
 * Fixed namespace UUID for fork block-identity derivation. Changing this value
 * would re-key every forked workflow's block ids, breaking webhook URLs and
 * external block references (table workflow groups, chat output configs) across
 * promotes - so it must never change.
 */
const FORK_BLOCK_NAMESPACE = '6f1c0e2a-9b3d-5e47-8a1c-2d4f6b8e0c13'

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

/**
 * Deterministic UUIDv5 (SHA-1) of `name` within `namespace`. The same inputs
 * always yield the same UUID, which is how fork block identity stays stable.
 */
function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
  hash.update(uuidToBytes(namespace))
  hash.update(Buffer.from(name, 'utf8'))
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Derive the target block id for a source block copied into a target workflow.
 *
 * Identity is deterministic in `(targetWorkflowId, sourceBlockId)`, so a logical
 * block keeps the same target id across every promote. This is what keeps trigger
 * webhook URLs consistent and keeps external block-id references (table workflow
 * groups, chat output configs, sim_trigger_state) valid across promotes. A source
 * block that no longer exists simply has no derived target, so the target block
 * disappears on the next force-replace.
 */
export function deriveForkBlockId(targetWorkflowId: string, sourceBlockId: string): string {
  return uuidV5(`${targetWorkflowId}:${sourceBlockId}`, FORK_BLOCK_NAMESPACE)
}
