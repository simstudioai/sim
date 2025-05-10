import { ToolResponse } from '../types'

export interface Mem0Response extends ToolResponse {
  output: {
    ids?: string[]
    memories?: any[]
    searchResults?: any[]
  }
}
