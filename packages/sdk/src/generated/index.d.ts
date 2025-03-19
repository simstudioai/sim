/**
 * Type declarations for the generated registry
 */

/**
 * List of all available tools in the main application
 */
export declare const availableTools: string[]

/**
 * List of all available blocks in the main application
 */
export declare const availableBlocks: string[]

/**
 * Map of tool IDs to their block types
 */
export declare const toolToBlockMap: Record<string, string>

/**
 * Required parameters for each tool
 */
export declare const toolRequiredParameters: Record<string, string[]>

/**
 * Required parameters for each block
 */
export declare const blockRequiredParameters: Record<string, string[]>

/**
 * Check if a tool is available
 */
export declare function isToolAvailable(toolId: string): boolean

/**
 * Check if a block is available
 */
export declare function isBlockAvailable(blockId: string): boolean

/**
 * Get the block type for a tool
 */
export declare function getBlockTypeForTool(toolId: string): string | undefined

/**
 * Get required parameters for a tool
 */
export declare function getToolRequiredParameters(toolId: string): string[]

/**
 * Get required parameters for a block
 */
export declare function getBlockRequiredParameters(blockId: string): string[] 