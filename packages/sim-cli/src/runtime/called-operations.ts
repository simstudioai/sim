import type { Command } from 'commander'
import type { V2OperationName } from '../generated/v2-api'

const CALLED_OPERATIONS = new WeakMap<Command, readonly V2OperationName[]>()
const RUNS_OPERATION = new WeakMap<Command, V2OperationName>()

/**
 * Records the one v2 operation whose request and response a command presents as its
 * own: every generated command, and a hand-written one that prints a single call's result.
 *
 * The command inventory reads it here rather than mapping paths back to operations: a
 * derived path can equal another operation's (`undeployWorkflow` derives
 * `workflows deploy`), and a reverse lookup by path then describes the wrong one.
 */
export function runsOperation(command: Command, operation: V2OperationName): Command {
  RUNS_OPERATION.set(command, operation)
  return command
}

export function operationOf(command: Command): V2OperationName | undefined {
  return RUNS_OPERATION.get(command)
}

/**
 * Records the v2 operations a hand-written command calls.
 *
 * A hand-written command is opaque until it says what it calls, and the inventory needs
 * that to describe it truthfully, such as whether every call is open to a Mothership
 * caller.
 */
export function callsOperations(command: Command, operations: readonly V2OperationName[]): Command {
  CALLED_OPERATIONS.set(command, operations)
  return command
}

export function calledOperations(command: Command): readonly V2OperationName[] | undefined {
  return CALLED_OPERATIONS.get(command)
}
