import { createLogger } from '@sim/logger'
import { describeError, toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { logFailureOnce } from '@/lib/core/errors/failure-log'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'

const logger = createLogger('InternalJsonToolOperation')

export async function executeInternalJsonToolOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    /** The 500 below carries only the message; the cause (a database code, a stack) lives here. */
    logFailureOnce(logger, errorMessage, error, { cause: describeError(error) })
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}
