import {
  mcpAppResourceBodySchema,
  mcpAppResourceResponseSchema,
  mcpAppToolBodySchema,
  mcpAppToolResponseSchema,
  mcpPresentationAssetParamsSchema,
  mcpPresentationMetadataResponseSchema,
  mcpPresentationParamsSchema,
  mcpPresentationResponseSchema,
} from '@/lib/api/contracts/mcp-presentations/schemas'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const getMcpPresentationContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]',
  params: mcpPresentationParamsSchema,
  response: { mode: 'json', schema: mcpPresentationResponseSchema },
})

export const getMcpPresentationMetadataContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/metadata',
  params: mcpPresentationParamsSchema,
  response: { mode: 'json', schema: mcpPresentationMetadataResponseSchema },
})

export const getMcpAppFrameContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/frame',
  params: mcpPresentationParamsSchema,
  response: { mode: 'binary' },
})

export const getMcpPresentationAssetContract = defineRouteContract({
  method: 'GET',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/assets/[index]',
  params: mcpPresentationAssetParamsSchema,
  response: { mode: 'binary' },
})

export const callMcpAppToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/tools',
  params: mcpPresentationParamsSchema,
  body: mcpAppToolBodySchema,
  response: { mode: 'json', schema: mcpAppToolResponseSchema },
})

export const readMcpAppResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/chats/[chatId]/mcp-results/[id]/resources',
  params: mcpPresentationParamsSchema,
  body: mcpAppResourceBodySchema,
  response: { mode: 'json', schema: mcpAppResourceResponseSchema },
})
