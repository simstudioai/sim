import type { McpTool } from '@/lib/mcp/types'

export interface McpCacheEntry {
  tools: McpTool[]
  expiry: number // Unix timestamp ms
}

export interface McpCacheMutationSet {
  key: string
  tools: McpTool[]
  ttlMs: number
}

export interface McpCacheStorageAdapter {
  get(key: string): Promise<McpCacheEntry | null>
  set(key: string, tools: McpTool[], ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /**
   * Starts an ordered mutation for one server and returns a monotonic Unix
   * timestamp in milliseconds. Conditional writes using an older mutation id
   * must be ignored so a slow discovery cannot overwrite a newer result. The
   * same value orders database publication for an end-to-end consistent state.
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
  /** Atomically applies one server's complete cache state if this mutation still owns it. */
  applyMutationIfCurrent(
    scopeKey: string,
    mutationId: number,
    setEntry: McpCacheMutationSet | null,
    deleteKeys: string[]
  ): Promise<boolean>
  clear(): Promise<void>
  dispose(): void
}
