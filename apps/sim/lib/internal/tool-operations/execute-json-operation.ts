import { toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'

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
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}
