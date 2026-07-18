import type { McpTool } from '@/lib/mcp/types'

export interface McpCacheEntry {
  tools: McpTool[]
  expiry: number // Unix timestamp ms
}

export interface McpCacheStorageAdapter {
  get(key: string): Promise<McpCacheEntry | null>
  set(key: string, tools: McpTool[], ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /**
   * Starts an ordered mutation for one server. Conditional writes using an
   * older mutation id must be ignored so a slow discovery cannot overwrite a
   * newer result.
   */
  beginMutation(scopeKey: string): Promise<number>
  setIfCurrentMutation(
    scopeKey: string,
    mutationId: number,
    key: string,
    tools: McpTool[],
    ttlMs: number
  ): Promise<boolean>
  deleteIfCurrentMutation(scopeKey: string, mutationId: number, key: string): Promise<boolean>
  clear(): Promise<void>
  dispose(): void
}
