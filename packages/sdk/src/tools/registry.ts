import { Tool } from './index'

/**
 * Interface for tool imports from the main application
 */
export interface ToolImport {
  id: string
  name: string
  description: string
  schema: any
  execute: (params: any) => Promise<any>
}

/**
 * Create a dynamic adapter for importing tools from the main application
 * This serves as a bridge between the main app's tools and our SDK
 */
export function createToolAdapter(tool: ToolImport): Tool {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    execute: tool.execute
  }
}

/**
 * Create a tool factory for a specific tool type
 */
export function createToolFactory<T extends Record<string, any>>(
  id: string,
  name: string,
  description: string,
  schema: any,
  executeFunction: (params: T) => Promise<any>
): (params?: Partial<T>) => Tool {
  return (params: Partial<T> = {}) => ({
    id,
    name,
    description,
    schema,
    execute: (inputParams: any) => executeFunction({ ...params, ...inputParams })
  })
} 