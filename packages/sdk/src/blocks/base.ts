import { BlockType, BlockData } from '../types'
import { Tool } from '../tools'
import { generateId as generateUniqueId } from '../utils'
import { blockRequiredParameters, getToolRequiredParameters } from '../generated'

/**
 * Base class for all workflow blocks
 */
export abstract class Block {
  id: string
  type: BlockType
  data: BlockData
  enabled: boolean
  metadata: {
    name?: string
    description?: string
    [key: string]: any
  }
  private tools: Tool[] = []

  // Define static property for required parameters that subclasses should override
  static requiredParameters: string[] = []

  constructor(type: BlockType, data: BlockData = {}) {
    this.id = generateUniqueId()
    this.type = type
    this.data = data
    this.enabled = true
    this.metadata = {}
    
    // Validate required parameters
    this.validateRequiredParameters()
  }

  /**
   * Validate that all required parameters are present
   */
  private validateRequiredParameters(): void {
    // First check static requirements from the class (if any)
    const staticRequiredParams = (this.constructor as typeof Block).requiredParameters
    if (staticRequiredParams.length > 0) {
      const missingParams = staticRequiredParams.filter(param => this.data[param] === undefined)
      if (missingParams.length > 0) {
        throw new Error(`Missing required parameters for ${this.type} block: ${missingParams.join(', ')}`)
      }
    }
    
    // Then check the dynamically generated requirements from the main app
    const dynamicRequiredParams = blockRequiredParameters[this.type] || []
    if (dynamicRequiredParams.length > 0) {
      const missingParams = dynamicRequiredParams.filter(param => this.data[param] === undefined)
      if (missingParams.length > 0) {
        throw new Error(`Missing required parameters for ${this.type} block: ${missingParams.join(', ')}`)
      }
    }
  }

  /**
   * Set the block's name
   */
  setName(name: string): this {
    this.metadata.name = name
    return this
  }

  /**
   * Set the block's description
   */
  setDescription(description: string): this {
    this.metadata.description = description
    return this
  }

  /**
   * Enable or disable the block
   */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled
    return this
  }

  /**
   * Set custom metadata
   */
  setMetadata(key: string, value: any): this {
    this.metadata[key] = value
    return this
  }

  /**
   * Add a tool to this block
   */
  addTool(tool: Tool): this {
    this.tools.push(tool)
    
    // If this is an agent block, update the data.tools array
    if (this.type === 'agent' && Array.isArray(this.data.tools)) {
      // Validate required tool parameters
      const requiredParams = getToolRequiredParameters(tool.id)
      if (requiredParams.length > 0) {
        const toolSettings = this.data.toolSettings?.[tool.id] || {}
        const missingParams = requiredParams.filter(param => 
          toolSettings[param] === undefined
        )
        
        if (missingParams.length > 0) {
          throw new Error(`Missing required parameters for tool '${tool.id}': ${missingParams.join(', ')}`)
        }
      }
      
      this.data.tools.push({
        name: tool.id,
        description: tool.description,
        parameters: tool.schema
      })
    }
    
    return this
  }

  /**
   * Get all tools attached to this block
   */
  getTools(): Tool[] {
    return this.tools
  }

  /**
   * Serialize the block for API requests
   */
  toJSON(): any {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      enabled: this.enabled,
      metadata: this.metadata,
    }
  }
}

/**
 * Generate a unique ID for blocks
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
} 