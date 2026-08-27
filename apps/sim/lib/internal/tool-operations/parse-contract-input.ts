import type { z } from 'zod'
import type {
  AnyApiRouteContract,
  ContractBody,
  ContractParams,
  ContractQuery,
} from '@/lib/api/contracts'
import { serializeZodIssues } from '@/lib/api/server/validation'

export interface ParsedInternalContractInput<P, Q, B> {
  params: P
  query: Q
  body: B
}

function validationError(error: z.ZodError): Response {
  return Response.json(
    { error: 'Validation error', details: serializeZodIssues(error) },
    { status: 400 }
  )
}

export function parseInternalContractInput<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  options: { maxInputBytes?: number } = {}
):
  | {
      success: true
      data: ParsedInternalContractInput<ContractParams<C>, ContractQuery<C>, ContractBody<C>>
    }
  | { success: false; response: Response } {
  if (options.maxInputBytes !== undefined) {
    let serialized: string
    try {
      serialized = JSON.stringify(input)
    } catch {
      return {
        success: false,
        response: Response.json({ error: 'Operation input must be valid JSON' }, { status: 400 }),
      }
    }
    if (Buffer.byteLength(serialized, 'utf8') > options.maxInputBytes) {
      return {
        success: false,
        response: Response.json(
          {
            error: `Operation input exceeds the maximum allowed size of ${options.maxInputBytes} bytes`,
          },
          { status: 413 }
        ),
      }
    }
  }

  const params = contract.params?.safeParse(input)
  if (params && !params.success) return { success: false, response: validationError(params.error) }

  const query = contract.query?.safeParse(input)
  if (query && !query.success) return { success: false, response: validationError(query.error) }

  const body = contract.body?.safeParse(input)
  if (body && !body.success) return { success: false, response: validationError(body.error) }

  return {
    success: true,
    data: {
      params: (params?.data ?? undefined) as ContractParams<C>,
      query: (query?.data ?? undefined) as ContractQuery<C>,
      body: (body?.data ?? undefined) as ContractBody<C>,
    },
  }
}
