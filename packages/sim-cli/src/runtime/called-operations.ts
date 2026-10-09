import type { Command } from 'commander'
import type { V2OperationName } from '../generated/v2-api'

const CALLED_OPERATIONS = new WeakMap<Command, readonly V2OperationName[]>()

/**
 * Records the v2 operations a hand-written command calls.
 *
 * A generated command is one operation and the command inventory finds it by path. A
 * hand-written one is opaque until it says what it calls, and the inventory needs that
 * to describe it truthfully, such as whether every call is open to a Mothership caller.
 */
export function callsOperations(command: Command, operations: readonly V2OperationName[]): Command {
  CALLED_OPERATIONS.set(command, operations)
  return command
}

export function calledOperations(command: Command): readonly V2OperationName[] | undefined {
  return CALLED_OPERATIONS.get(command)
}
