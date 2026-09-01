import { omit } from '@sim/utils/object'

/** Removes executor-only scope before a tool's semantic input crosses the operation boundary. */
export function createInternalToolOperationInput<Params extends object>(
  params: Params
): Omit<Params, '_context'> {
  return omit(params as Params & { _context?: unknown }, ['_context'])
}
