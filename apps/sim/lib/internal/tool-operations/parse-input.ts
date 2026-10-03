import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'

interface ParseInternalToolInputOptions {
  maxInputBytes?: number
}

export type InternalToolInputParseResult<C extends AnyApiRouteContract> =
  | { success: true; data: ContractBody<C> }
  | { success: false; response: Response }

export function parseInternalToolInput<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  options: ParseInternalToolInputOptions = {}
): InternalToolInputParseResult<C> {
  if (
    options.maxInputBytes !== undefined &&
    Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') > options.maxInputBytes
  ) {
    return {
      success: false,
      response: Response.json(
        {
          error: `Request body exceeds the maximum allowed size of ${options.maxInputBytes} bytes`,
        },
        { status: 413 }
      ),
    }
  }

  if (!contract.body) {
    return { success: true, data: undefined as ContractBody<C> }
  }

  const parsed = contract.body.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      response: Response.json(
        { error: 'Invalid request data', details: parsed.error.issues },
        { status: 400 }
      ),
    }
  }

  return { success: true, data: parsed.data as ContractBody<C> }
}
