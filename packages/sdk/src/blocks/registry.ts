import { Block } from './base'
import { availableBlocks, toolToBlockMap } from '../generated/registry'

/**
 * Registry for all available block types
 */
export class BlockRegistry {
  private static blocks: Map<string, new (...args: any[]) => Block> = new Map()
  private static blockOptions: Map<string, any> = new Map()

  /**
   * Register a block type
   */
  static register<T extends Block>(
    id: string, 
    blockClass: new (...args: any[]) => T,
    options?: {
      category?: string
      description?: string
      icon?: string
      defaultData?: any
      schema?: any
    }
  ): void {
    this.blocks.set(id, blockClass)
    if (options) {
      this.blockOptions.set(id, options)
    }
  }

  /**
   * Create a new block instance by ID
   */
  static create(id: string, data?: any): Block | null {
    const BlockClass = this.blocks.get(id)
    if (!BlockClass) {
      return null
    }
    return new BlockClass(data)
  }

  /**
   * Check if a block type is registered
   */
  static has(id: string): boolean {
    return this.blocks.has(id)
  }

  /**
   * Get all registered block types
   */
  static getAll(): string[] {
    return Array.from(this.blocks.keys())
  }

  /**
   * Get block options for a specific block type
   */
  static getOptions(id: string): any {
    return this.blockOptions.get(id) || {}
  }

  /**
   * Check if a block is available in the main application
   */
  static isAvailableInMainApp(id: string): boolean {
    return availableBlocks.includes(id)
  }

  /**
   * Get the block type for a tool
   */
  static getBlockTypeForTool(toolId: string): string | undefined {
    return toolToBlockMap[toolId]
  }

  /**
   * Get all available block types from the main application
   */
  static getAllAvailableBlocks(): string[] {
    return [...availableBlocks]
  }
}

/**
 * Decorator for registering a block class with the registry
 */
export function registerBlock(
  id: string,
  options?: {
    category?: string
    description?: string
    icon?: string
    defaultData?: any
    schema?: any
  }
): ClassDecorator {
  return (target: any) => {
    BlockRegistry.register(id, target, options)
    return target
  }
}

/**
 * Interface for block imports from the main application
 */
export interface BlockImport {
  id: string
  blockClass: new (...args: any[]) => Block
  options?: {
    category?: string
    description?: string
    icon?: string
    defaultData?: any
    schema?: any
  }
}

/**
 * Import blocks from the main application
 */
export function importBlocks(blocks: BlockImport[]): void {
  blocks.forEach(block => {
    BlockRegistry.register(block.id, block.blockClass, block.options)
  })
} 