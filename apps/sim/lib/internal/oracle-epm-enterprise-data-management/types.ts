import type { z } from 'zod'
import type { OracleEpmClient, OracleEpmClientResponse } from '@/lib/internal/oracle-epm'
import type {
  edmApplicationSchema,
  edmDimensionSchema,
  edmInputSchemas,
  edmJobResultSchema,
  edmJobSchema,
  edmNodeSchema,
  edmRequestSchema,
  edmViewpointSchema,
  edmViewSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'

export type EdmAction = keyof typeof edmInputSchemas
export type EdmInput<A extends EdmAction = EdmAction> = z.output<(typeof edmInputSchemas)[A]>
export type EdmInputParams<A extends EdmAction> = z.input<(typeof edmInputSchemas)[A]>
export type EdmApplication = z.output<typeof edmApplicationSchema>
export type EdmDimension = z.output<typeof edmDimensionSchema>
export type EdmView = z.output<typeof edmViewSchema>
export type EdmViewpoint = z.output<typeof edmViewpointSchema>
export type EdmNode = z.output<typeof edmNodeSchema>
export type EdmRequest = z.output<typeof edmRequestSchema>
export type EdmJob = z.output<typeof edmJobSchema>
export type EdmJobResult = z.output<typeof edmJobResultSchema>
export interface EdmOperationContext {
  client: OracleEpmClient
  instanceUrl: string
  signal?: AbortSignal
  execution: InternalToolOperationContext
}
export interface EdmAsyncOutput {
  jobId: string
  job: EdmJob | null
  completed: boolean
  timedOut: boolean
  result?: EdmJobResult
  file?: UserFile
  fileName?: string
}
export interface EdmHierarchyNode extends EdmNode {
  depth: number
  traversalPath: string[]
  traversalParentLocation: string | null
}
export interface EdmHierarchyFrontier {
  parentNodeId: string | null
  parentLocation: string | null
  path: string[]
  depth: number
  offset: number
}

/** Fixed, product-authored failures; never construct these from provider or storage error text. */
export class EdmOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly output?: EdmAsyncOutput
  ) {
    super(message)
    this.name = 'EdmOperationError'
  }
}

export function edmJsonData(response: OracleEpmClientResponse): unknown {
  if (!('data' in response))
    throw new EdmOperationError('Oracle EDM returned an invalid JSON response', 502)
  return response.data
}
