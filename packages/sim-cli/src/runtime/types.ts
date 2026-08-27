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
  /** Contract-declared request headers, minus any the CLI sets itself. */
  headers?: Record<string, FieldSpec>
  opaqueBody?: boolean
  summary?: string
  /**
   * The operation rejects a workspace API key; only a personal one works.
   *
   * Emitted by `scripts/generate-v2-cli-api.ts` from the OpenAPI description so
   * `--help` states the restriction the caller would otherwise meet as a `403`.
   */
  personalKeyOnly?: true
  responseMode?: 'json' | 'binary' | 'stream'
}
