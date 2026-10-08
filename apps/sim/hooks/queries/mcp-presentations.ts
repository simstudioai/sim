import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  callMcpAppToolContract,
  getMcpPresentationContract,
  type McpAppResourceBody,
  type McpAppToolBody,
  readMcpAppResourceContract,
} from '@/lib/api/contracts/mcp-presentations'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'

const MCP_PRESENTATION_STALE_TIME = 0

export function useMcpPresentation(chatId: string, id: string) {
  return useQuery({
    queryKey: mcpKeys.presentation(chatId, id),
    queryFn: ({ signal }) =>
      requestJson(getMcpPresentationContract, { params: { chatId, id }, signal }),
    staleTime: MCP_PRESENTATION_STALE_TIME,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useMcpAppTool(chatId: string, id: string) {
  return useMutation({
    mutationFn: ({ body, signal }: { body: McpAppToolBody; signal: AbortSignal }) =>
      requestJson(callMcpAppToolContract, { params: { chatId, id }, body, signal }),
    gcTime: 0,
    retry: false,
  })
}

export function useMcpAppResource(chatId: string, id: string) {
  return useMutation({
    mutationFn: ({ body, signal }: { body: McpAppResourceBody; signal: AbortSignal }) =>
      requestJson(readMcpAppResourceContract, { params: { chatId, id }, body, signal }),
    gcTime: 0,
    retry: false,
  })
}
