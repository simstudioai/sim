import type { RequestOptions } from '../http/client'
import type { FieldSpec } from './request'

export interface OperationSpec {
  method: NonNullable<RequestOptions['method']>
  path: string
  pathParams: readonly string[]
  /** `.describe()` per path parameter, used as positional-argument help. */
  pathParamDocs?: Record<string, string>
  query?: Record<string, FieldSpec>
  body?: Record<string, FieldSpec>
  opaqueBody?: boolean
  summary?: string
  responseMode?: 'json' | 'binary' | 'stream'
}
