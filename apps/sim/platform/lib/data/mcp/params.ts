'use client'

import { useQueryState } from 'nuqs'
import { serverTabParam, serverTabUrlKeys } from '@/lib/settings/search-params'

/** The open workflow MCP server's tab: Details or Workflows. */
export function useMcpServerTabParam() {
  return useQueryState(serverTabParam.key, { ...serverTabParam.parser, ...serverTabUrlKeys })
}
