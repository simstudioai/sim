import { z } from 'zod'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const jupyterProxyBodySchema = z.object({
  serverUrl: z.string().min(1, 'Server URL is required'),
  token: z.string().min(1, 'Token is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1, 'Path is required'),
  body: z.unknown().optional().nullable(),
})

export const jupyterProxyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jupyter/proxy',
  body: jupyterProxyBodySchema,
  // untyped-response: the route mirrors the upstream Jupyter server's response
  // verbatim (status + body), which varies per Contents/Kernels/Sessions endpoint
  response: { mode: 'json', schema: z.unknown() },
})

export type JupyterProxyBody = ContractBodyInput<typeof jupyterProxyContract>
export type JupyterProxyResponse = ContractJsonResponse<typeof jupyterProxyContract>
