import type { z } from 'zod'
import {
  createOracleEpmClient,
  type OracleEpmClient,
  type OracleEpmClientResponse,
} from '@/lib/internal/oracle-epm'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { FccsAuthParams } from '@/tools/oracle_epm_fccs/types'
import type { ToolResponse } from '@/tools/types'

export interface FccsContext {
  client: OracleEpmClient
  signal?: AbortSignal
  execution?: InternalToolOperationContext
}

export function createFccsContext(
  params: FccsAuthParams,
  signal?: AbortSignal,
  execution?: InternalToolOperationContext
): FccsContext {
  signal?.throwIfAborted()
  if (!params.accessToken || !params.instanceUrl)
    throw new Error('Select an Oracle EPM service account credential')
  return {
    client: createOracleEpmClient({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
    }),
    signal,
    execution,
  }
}

/** Never expose unknown successful response fields or a Zod error containing provider data. */
export function projectFccsResponse<T>(schema: z.ZodType<T>, response: OracleEpmClientResponse): T {
  if (!('data' in response)) throw new Error('Oracle EPM FCCS returned an unexpected response type')
  const parsed = schema.safeParse(response.data)
  if (!parsed.success)
    throw new Error('Oracle EPM FCCS returned an undocumented or malformed response')
  return parsed.data
}

export function fccsResult(output: Record<string, unknown>): ToolResponse {
  return { success: true, output }
}

/** Typed request validation keeps literal member names and filenames unchanged. */
export function parseFccsInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) => issue.path[0]).filter((key) => typeof key === 'string')
      ),
    ]
    throw new Error(`Invalid FCCS input${fields.length ? `: ${fields.join(', ')}` : ''}`)
  }
  return parsed.data
}
