import { Workflow, Block } from '../types'

/**
 * Options for code generation
 */
export interface CodeGenerationOptions {
  /**
   * Include comments in generated code
   */
  includeComments?: boolean
  
  /**
   * Format the code with proper indentation
   */
  prettyPrint?: boolean
  
  /**
   * Add a timestamp and generator information
   */
  addGenerationInfo?: boolean
  
  /**
   * Export workflow as a module
   */
  exportAsModule?: boolean
  
  /**
   * Name of the main function
   */
  mainFunctionName?: string
  
  /**
   * ESNext or CommonJS module format
   */
  moduleFormat?: 'esm' | 'commonjs'
}

/**
 * Generates TypeScript code from a workflow
 */
export class WorkflowCodeGenerator {
  private workflow: Workflow
  private options: Required<CodeGenerationOptions>
  
  constructor(workflow: Workflow, options: CodeGenerationOptions = {}) {
    this.workflow = workflow
    this.options = {
      includeComments: options.includeComments ?? true,
      prettyPrint: options.prettyPrint ?? true,
      addGenerationInfo: options.addGenerationInfo ?? true,
      exportAsModule: options.exportAsModule ?? true,
      mainFunctionName: options.mainFunctionName ?? this.sanitizeName(workflow.name || 'workflow'),
      moduleFormat: options.moduleFormat ?? 'esm',
    }
  }
  
  /**
   * Generate TypeScript code representing the workflow
   */
  generate(): string {
    const parts: string[] = []
    
    // Add generation info if requested
    if (this.options.addGenerationInfo) {
      parts.push(this.generateHeader())
    }
    
    // Add imports
    parts.push(this.generateImports())
    
    // Add block declarations
    parts.push(this.generateBlockDeclarations())
    
    // Add main function
    parts.push(this.generateMainFunction())
    
    // Join all parts
    return parts.join('\n\n')
  }
  
  /**
   * Generate header comment with generation info
   */
  private generateHeader(): string {
    const date = new Date().toISOString()
    return [
      '/**',
      ' * This code was generated from a Sim Studio workflow',
      ` * Workflow: ${this.workflow.name || 'Unnamed workflow'}`,
      ` * Generated: ${date}`,
      ' */',
    ].join('\n')
  }
  
  /**
   * Generate imports section
   */
  private generateImports(): string {
    if (this.options.moduleFormat === 'esm') {
      return [
        "import { SimStudio } from '@sim-studio/sdk'",
        this.getBlockImports(),
      ].join('\n')
    } else {
      return [
        "const { SimStudio } = require('@sim-studio/sdk')",
        this.getBlockImports('commonjs'),
      ].join('\n')
    }
  }
  
  /**
   * Generate imports for block types used in the workflow
   */
  private getBlockImports(format: 'esm' | 'commonjs' = 'esm'): string {
    const blockTypes = new Set<string>()
    
    for (const block of this.workflow.blocks) {
      const blockType = this.getBlockClassName(block)
      if (blockType && blockType !== 'StarterBlock') {
        blockTypes.add(blockType)
      }
    }
    
    if (blockTypes.size === 0) {
      return ''
    }
    
    const blockTypesList = Array.from(blockTypes).sort()
    
    if (format === 'esm') {
      return `import { ${blockTypesList.join(', ')} } from '@sim-studio/sdk'`
    } else {
      return `const { ${blockTypesList.join(', ')} } = require('@sim-studio/sdk')`
    }
  }
  
  /**
   * Generate declarations for all blocks
   */
  private generateBlockDeclarations(): string {
    return this.workflow.blocks
      .filter(block => block.enabled !== false && block.metadata?.id !== 'starter')
      .map(block => this.generateBlockDeclaration(block))
      .join('\n\n')
  }
  
  /**
   * Generate the main function that creates and executes the workflow
   */
  private generateMainFunction(): string {
    const lines: string[] = []
    
    // Function signature
    if (this.options.exportAsModule) {
      lines.push(`export async function ${this.options.mainFunctionName}(input = {}) {`)
    } else {
      lines.push(`async function ${this.options.mainFunctionName}(input = {}) {`)
    }
    
    // Initialize SDK
    lines.push('  // Initialize the SDK')
    lines.push("  const simStudio = new SimStudio()")
    lines.push('')
    
    // Create workflow
    lines.push('  // Create a new workflow')
    lines.push(`  const workflowBuilder = simStudio.createWorkflow('${this.workflow.name || 'Generated Workflow'}')`)
    lines.push('')
    
    // Add blocks
    lines.push('  // Add blocks to the workflow')
    for (const block of this.workflow.blocks) {
      if (block.metadata?.id !== 'starter' && block.enabled !== false) {
        const varName = this.getBlockVariableName(block)
        lines.push(`  workflowBuilder.addBlock(${varName})`)
      }
    }
    lines.push('')
    
    // Get starter block
    lines.push('  // Get the starter block')
    lines.push('  const starterBlock = workflowBuilder.getStarterBlock()')
    lines.push('')
    
    // Connect blocks
    lines.push('  // Connect blocks')
    const connections = this.generateConnectionsCode()
    connections.forEach(conn => lines.push(`  ${conn}`))
    lines.push('')
    
    // Create loops if any
    if (this.workflow.loops && Object.keys(this.workflow.loops).length > 0) {
      lines.push('  // Create loops')
      for (const [loopId, loop] of Object.entries(this.workflow.loops)) {
        const nodesArray = JSON.stringify(loop.nodes)
        lines.push(`  workflowBuilder.createLoop(${nodesArray}, ${loop.maxIterations}${loop.iterationVariable ? `, '${loop.iterationVariable}'` : ''})`)
      }
      lines.push('')
    }
    
    // Save workflow
    lines.push('  // Save and execute the workflow')
    lines.push('  const workflow = await workflowBuilder.build()')
    lines.push('  return workflow')
    
    // Close function
    lines.push('}')
    
    // Add example if not a module
    if (!this.options.exportAsModule) {
      lines.push('')
      lines.push(`// Execute the workflow with sample input`)
      lines.push(`${this.options.mainFunctionName}({`)
      lines.push(`  // Add your input here`)
      lines.push(`}).then(console.log).catch(console.error)`)
    }
    
    return lines.join('\n')
  }
  
  /**
   * Generate a single block declaration
   */
  private generateBlockDeclaration(block: Block): string {
    const varName = this.getBlockVariableName(block)
    const className = this.getBlockClassName(block)
    const blockData = JSON.stringify(block.data, null, 2)
      .replace(/"([^"]+)":/g, '$1:')  // Convert "key": to key:
      .replace(/"/g, "'") // Convert double quotes to single quotes
    
    let declaration = `const ${varName} = new ${className}(${blockData})`
    
    // Add name and description if available
    if (block.metadata?.name) {
      declaration += `.setName('${block.metadata.name.replace(/'/g, "\\'")}')` 
    }
    
    if (block.metadata?.description) {
      declaration += `.setDescription('${block.metadata.description.replace(/'/g, "\\'")}')` 
    }
    
    return declaration + ''
  }
  
  /**
   * Generate code for all connections
   */
  private generateConnectionsCode(): string[] {
    return this.workflow.connections.map(conn => {
      let sourceId = conn.source
      let targetId = conn.target
      
      // Try to use variable names when possible
      const sourceBlock = this.workflow.blocks.find(b => b.id === conn.source)
      const targetBlock = this.workflow.blocks.find(b => b.id === conn.target)
      
      if (sourceBlock?.metadata?.id === 'starter') {
        sourceId = 'starterBlock.id'
      } else if (sourceBlock) {
        sourceId = `${this.getBlockVariableName(sourceBlock)}.id`
      }
      
      if (targetBlock) {
        targetId = `${this.getBlockVariableName(targetBlock)}.id`
      }
      
      let options = ''
      if (conn.sourceHandle || conn.targetHandle) {
        const optionsObj: Record<string, string> = {}
        if (conn.sourceHandle) optionsObj.sourceHandle = `'${conn.sourceHandle}'`
        if (conn.targetHandle) optionsObj.targetHandle = `'${conn.targetHandle}'`
        
        options = `, { ${Object.entries(optionsObj).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
      }
      
      return `workflowBuilder.connect(${sourceId}, ${targetId}${options})`
    })
  }
  
  /**
   * Generate a variable name for a block
   */
  private getBlockVariableName(block: Block): string {
    if (block.metadata?.id === 'starter') {
      return 'starterBlock'
    }
    
    // Use the block name if available
    if (block.metadata?.name) {
      return this.sanitizeName(block.metadata.name, true)
    }
    
    // Fall back to block type + ID
    return `${block.type}Block_${block.id}`
  }
  
  /**
   * Get the class name for a block
   */
  private getBlockClassName(block: Block): string | null {
    const blockTypeId = block.metadata?.id || block.type
    
    // Map block types to class names
    const blockTypeToClass: Record<string, string> = {
      'starter': 'StarterBlock',
      'agent': 'AgentBlock',
      'function': 'FunctionBlock',
      'condition': 'ConditionBlock',
      'router': 'RouterBlock',
      'api': 'ApiBlock',
      'evaluator': 'EvaluatorBlock',
      'openai': 'OpenAIBlock',
      'tavily': 'TavilyBlock',
      'slack': 'SlackBlock',
      'jina': 'JinaBlock',
      'serper': 'SerperBlock',
      'pinecone': 'PineconeBlock',
      'github': 'GitHubBlock',
      'gmail': 'GmailBlock',
      'notion': 'NotionBlock',
      'sheets': 'SheetsBlock',
      'drive': 'DriveBlock',
      'docs': 'DocsBlock',
      'x': 'XBlock'
    }
    
    return blockTypeToClass[blockTypeId] || `${this.capitalize(blockTypeId)}Block`
  }
  
  /**
   * Generate a sanitized name that can be used as a variable name
   */
  private sanitizeName(name: string, camelCase: boolean = false): string {
    // Replace non-alphanumeric characters with underscores
    let sanitized = name.replace(/[^a-zA-Z0-9]/g, '_')
    
    // Ensure it starts with a letter
    if (!/^[a-zA-Z]/.test(sanitized)) {
      sanitized = 'block_' + sanitized
    }
    
    // Convert to camelCase if requested
    if (camelCase) {
      sanitized = sanitized.replace(/_([a-zA-Z])/g, (_, char) => char.toUpperCase())
      sanitized = sanitized.charAt(0).toLowerCase() + sanitized.slice(1)
    }
    
    return sanitized
  }
  
  /**
   * Capitalize the first letter of a string
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}

/**
 * Convenience function to generate TypeScript code from a workflow
 */
export function generateCode(workflow: Workflow, options: CodeGenerationOptions = {}): string {
  const generator = new WorkflowCodeGenerator(workflow, options)
  return generator.generate()
} 