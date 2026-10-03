import type { z } from 'zod'
import type {
  AnyApiRouteContract,
  ApiSchema,
  ContractBody,
  ContractParams,
  ContractQuery,
  EmptySchemaOutput,
} from '@/lib/api/contracts'
import { serializeZodIssues } from '@/lib/api/server/validation'

export interface ParsedInternalContractInput<P, Q, B> {
  params: P
  query: Q
  body: B
}

/**
 * The request slices an in-process operation validates, for an operation whose
 * HTTP route has been retired: it passes its schemas directly rather than
 * keeping a contract that declares a `method` and `path` nothing serves.
 */
export interface InternalOperationSchemas {
  params?: ApiSchema
  query?: ApiSchema
  body?: ApiSchema
}

type ParseResult<P, Q, B> =
  | { success: true; data: ParsedInternalContractInput<P, Q, B> }
  | { success: false; response: Response }

function validationError(error: z.ZodError): Response {
  return Response.json(
    { error: 'Validation error', details: serializeZodIssues(error) },
    { status: 400 }
  )
}

/**
 * Contract callers keep their own entry point because `ContractParams<C>` and
 * friends `infer` each slice out of the contract's generics. Reading the same
 * slices off an optional-property shape widens every one of them with
 * `undefined`, which breaks narrowing at every call site.
 */
export function parseInternalContractInput<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  options: { maxInputBytes?: number } = {}
): ParseResult<ContractParams<C>, ContractQuery<C>, ContractBody<C>> {
  return parseInternalOperationInput(contract, input, options) as ParseResult<
    ContractParams<C>,
    ContractQuery<C>,
    ContractBody<C>
  >
}

export function parseInternalOperationInput<S extends InternalOperationSchemas>(
  schemas: S,
  input: unknown,
  options: { maxInputBytes?: number } = {}
): ParseResult<
  EmptySchemaOutput<S['params']>,
  EmptySchemaOutput<S['query']>,
  EmptySchemaOutput<S['body']>
> {
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

  const params = schemas.params?.safeParse(input)
  if (params && !params.success) return { success: false, response: validationError(params.error) }

  const query = schemas.query?.safeParse(input)
  if (query && !query.success) return { success: false, response: validationError(query.error) }

  const body = schemas.body?.safeParse(input)
  if (body && !body.success) return { success: false, response: validationError(body.error) }

  return {
    success: true,
    data: {
      params: (params?.data ?? undefined) as EmptySchemaOutput<S['params']>,
      query: (query?.data ?? undefined) as EmptySchemaOutput<S['query']>,
      body: (body?.data ?? undefined) as EmptySchemaOutput<S['body']>,
    },
  }
}
