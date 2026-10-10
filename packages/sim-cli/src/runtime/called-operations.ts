import type { Command } from 'commander'
import type { ResolvedProfile } from '../config/index'
import { clientFrom } from '../context'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import {
  type RequestAllPagesOptions,
  type RequestOptions,
  requestAllPages,
  resolvePath,
  type SimClient,
  type WorkspaceOptions,
} from '../http/client'
import { commandPath } from './derive'

const CALLED_OPERATIONS = new WeakMap<Command, readonly V2OperationName[]>()
const RUNS_OPERATION = new WeakMap<Command, V2OperationName>()

/**
 * The one operation whose request and response a command presents as its own, as its
 * declaration named it: every generated command, and a hand-written one that prints a
 * single call's result.
 *
 * The inventory reads it here rather than mapping paths back to operations: a derived
 * path can equal another operation's (`undeployWorkflow` derives `workflows deploy`), and
 * a reverse lookup by path then describes the wrong one.
 */
export function operationOf(command: Command): V2OperationName | undefined {
  return RUNS_OPERATION.get(command)
}

/** The v2 operations a command declared it calls; absent when it calls none. */
export function calledOperations(command: Command): readonly V2OperationName[] | undefined {
  return CALLED_OPERATIONS.get(command)
}

/** Options for a call to a named operation; `params` fills its `[param]` path segments. */
type OperationOptions<Options extends RequestOptions> = Omit<Options, 'method'> & {
  params?: Record<string, string>
}

type ClientCalls = Pick<SimClient, 'request' | 'requestRaw' | 'requireWorkspace'>

/**
 * How a command reaches the API: each call names its operation, and only the operations
 * the command declared are accepted.
 *
 * Route and method come from the operation table, so no call can address an endpoint
 * the declaration leaves out. That keeps the inventory's view of a command, and with it
 * whether Mothership may run it, true without a list anyone has to keep in sync.
 */
export class OperationClient<Operation extends V2OperationName> {
  constructor(
    private readonly client: ClientCalls,
    private readonly operations: ReadonlySet<V2OperationName>,
    private readonly caller: string
  ) {}

  requireWorkspace(explicit?: string, options?: WorkspaceOptions): string {
    return this.client.requireWorkspace(explicit, options)
  }

  async request<T>(
    operation: Operation,
    { params, ...options }: OperationOptions<RequestOptions> = {}
  ): Promise<T> {
    return this.client.request<T>(this.route(operation, params), {
      ...options,
      method: V2_OPERATIONS[operation].method,
    })
  }

  async requestRaw(
    operation: Operation,
    { params, ...options }: OperationOptions<RequestOptions> = {}
  ): Promise<Response> {
    return this.client.requestRaw(this.route(operation, params), {
      ...options,
      method: V2_OPERATIONS[operation].method,
    })
  }

  async requestAllPages<T>(
    operation: Operation,
    { params, ...options }: OperationOptions<RequestAllPagesOptions>
  ): Promise<T[]> {
    return requestAllPages<T>(this.client, this.route(operation, params), {
      ...options,
      method: V2_OPERATIONS[operation].method,
    })
  }

  /**
   * The same declared operations over another client. A request's own signal cannot
   * stand in: the client also honours its profile's signal, which is what a cleanup
   * after cancellation has to escape.
   */
  over(client: ClientCalls): OperationClient<Operation> {
    return new OperationClient(client, this.operations, this.caller)
  }

  private route(operation: V2OperationName, params?: Record<string, string>): string {
    if (!this.operations.has(operation)) {
      throw new Error(`"${this.caller}" calls ${operation}, which it does not declare`)
    }
    return resolvePath(V2_OPERATIONS[operation].path, params)
  }
}

export interface Connection<Operation extends V2OperationName> {
  client: OperationClient<Operation>
  profile: ResolvedProfile
}

function caller(command: Command): string {
  return `sim ${commandPath(command).join(' ')}`
}

/**
 * Connects a command by its declaration, for code handed the command rather than the
 * declaration: the generated handler, and the protocols layered onto a generated leaf.
 * Naming the operations a caller relies on types the client to them and refuses a
 * declaration that leaves one out.
 */
export function connect<const Operation extends V2OperationName = V2OperationName>(
  command: Command,
  expects: readonly Operation[] = []
): Connection<Operation> {
  const operations = new Set(CALLED_OPERATIONS.get(command))
  const missing = operations.size === 0 ? 'what it calls' : expects.find((o) => !operations.has(o))
  if (missing) {
    throw new Error(`"${caller(command)}" calls the API without declaring ${missing}`)
  }
  const { client, profile } = clientFrom(command)
  return { client: new OperationClient(client, operations, caller(command)), profile }
}

interface Declaration<Operation extends V2OperationName> {
  /** The one operation whose result the command prints as its own. */
  runs?: NoInfer<Operation>
}

/**
 * Declares every v2 operation a command can call, and returns how it connects: a client
 * typed to exactly these operations, so a call to any other does not compile.
 */
export function callsOperations<const Operation extends V2OperationName>(
  command: Command,
  operations: readonly Operation[],
  { runs }: Declaration<Operation> = {}
): () => Connection<Operation> {
  CALLED_OPERATIONS.set(command, operations)
  if (runs) RUNS_OPERATION.set(command, runs)
  return () => connect(command, operations)
}

/** Adds a subcommand that calls the API, declared before anything else is attached. */
export function apiCommand<const Operation extends V2OperationName>(
  parent: Command,
  name: string,
  operations: readonly Operation[],
  declaration: Declaration<Operation> = {}
): [Command, () => Connection<Operation>] {
  const command = parent.command(name)
  return [command, callsOperations(command, operations, declaration)]
}
