import type { McpTransport } from '@/lib/mcp/types'

/**
 * Represents a single header entry in the form.
 * Using an array of objects allows duplicate keys during editing.
 */
export interface HeaderEntry {
  key: string
  value: string
}

export interface McpServerFormData {
  name: string
  transport: McpTransport
  url?: string
  timeout?: number
  headers?: HeaderEntry[]
}

export interface McpServerTestResult {
  success: boolean
  message?: string
  error?: string
  warnings?: string[]
}

export type InputFieldType = 'url' | 'header-key' | 'header-value'

export interface EnvVarDropdownConfig {
  searchTerm: string
  cursorPosition: number
  workspaceId: string
  onSelect: (value: string) => void
  onClose: () => void
}
