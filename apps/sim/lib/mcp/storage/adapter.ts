import type { McpTool } from '@/lib/mcp/types'

export interface McpCacheEntry {
  tools: McpTool[]
  expiry: number // Unix timestamp ms
}

export interface McpCacheStorageAdapter {
  get(key: string): Promise<McpCacheEntry | null>
  set(key: string, tools: McpTool[], ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  dispose(): void
}
