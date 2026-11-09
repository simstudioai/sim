'use client'

import { useQueryState } from 'nuqs'
import {
  mcpServerIdParam,
  mcpServerIdUrlKeys,
  serverTabParam,
  serverTabUrlKeys,
} from '@/lib/settings/search-params'

/** The MCP server a Settings section has open, shared by MCP tools and MCP servers deep links. */
export function useMcpServerIdParam() {
  return useQueryState(mcpServerIdParam.key, { ...mcpServerIdParam.parser, ...mcpServerIdUrlKeys })
}

/** The open workflow MCP server's tab: Details or Workflows. */
export function useMcpServerTabParam() {
  return useQueryState(serverTabParam.key, { ...serverTabParam.parser, ...serverTabUrlKeys })
}
