import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const MEMORY_EXECUTOR_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['executor'],
} as const

/**
 * Memory is the executor's own store: an Agent block writes and reads it inside
 * a run the workspace already authorized, and no permission-group key names it.
 * A gate here would fail runs the group permits rather than withhold a
 * capability from a member, so these operations declare `'none'`.
 */
function readOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...MEMORY_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function writeOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'none',
    ...MEMORY_EXECUTOR_PRINCIPAL_POLICY,
  })
}

export const memoryOperations = {
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  list: readOperation('memory.list'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  read: readOperation('memory.read'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  append: writeOperation('memory.append'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  delete: writeOperation('memory.delete'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  openTurn: writeOperation('memory.turn.open'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  saveTurn: writeOperation('memory.turn.save'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  appendTurnMessage: writeOperation('memory.turn.message.append'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  readItems: readOperation('memory.items.read'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  storeArtifact: writeOperation('memory.artifact.store'),
  // permission-group-exempt: the executor's own per-run store; no group key names it, and refusing would fail runs the group allows
  readArtifact: readOperation('memory.artifact.read'),
  // permission-group-exempt: the executor's own per-run store; no group key names it
  retrieve: readOperation('memory.retrieve'),
  // permission-group-exempt: the executor's derived conversation context cache has no separate capability
  readSummary: readOperation('memory.summary.read'),
  // permission-group-exempt: the executor's derived conversation context cache has no separate capability
  saveSummary: writeOperation('memory.summary.save'),
} as const
