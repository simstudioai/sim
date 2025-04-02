import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import * as dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

console.log('SIM_APP_PATH:', process.env.SIM_APP_PATH)

/**
 * Script to synchronize tools and blocks from the main app to the SDK
 * This script should be run as part of the build process
 */

// Paths to look for the main app files
const POSSIBLE_MAIN_APP_PATHS = [
  // Path from environment variable (should be the most reliable)
  process.env.SIM_APP_PATH ? path.join(process.env.SIM_APP_PATH, 'app/tools') : '',
  process.env.SIM_APP_PATH ? path.join(process.env.SIM_APP_PATH, 'app/blocks') : '',
  
  // Direct relative paths from the script's location
  '../../sim/app/tools',
  '../../sim/app/blocks',
  
  // From project root
  '../sim/app/tools',
  '../sim/app/blocks',
  
  // From monorepo root
  '../../sim/app/tools', 
  '../../sim/app/blocks',
  
  // Path based on common monorepo structure
  '../../../sim/app/tools', 
  '../../../sim/app/blocks',
].filter(Boolean)

const OUTPUT_REGISTRY_PATH = '../generated/registry.ts'

export async function syncFromMainApp() {
  try {
    // Ensure output directory exists
    const outputDir = path.resolve(__dirname, '../generated')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Find the directories
    const toolsDir = findDir('tools')
    const blocksDir = findDir('blocks')

    console.log("Tools directory:", toolsDir)
    console.log("Blocks directory:", blocksDir)

    // Extract tools and blocks
    const tools = toolsDir ? extractToolsFromDir(toolsDir) : new Map<string, string[]>()
    const blocks = blocksDir ? extractBlocksFromDir(blocksDir) : new Map<string, string[]>()

    // Get the registry data
    const toolRegistry = toolsDir ? extractToolsRegistry(path.join(toolsDir, 'index.ts')) : []
    const blockRegistry = blocksDir ? extractBlocksRegistry(path.join(blocksDir, 'index.ts')) : []

    // Combine the information
    const combinedTools = mergeToolsInfo(toolRegistry, tools)
    const combinedBlocks = mergeBlocksInfo(blockRegistry, blocks)

    // Generate registry file
    generateRegistryFile(combinedTools, combinedBlocks)

    console.log('Successfully synchronized tools and blocks from main app')
    if (!toolsDir) console.log('Warning: Tools directory not found')
    if (!blocksDir) console.log('Warning: Blocks directory not found')
  } catch (error) {
    console.error('Error synchronizing from main app:', error)
    // Generate empty registry if failed
    generateRegistryFile([], [])
  }
}

function findDir(type: 'tools' | 'blocks'): string | null {
  const possiblePaths = POSSIBLE_MAIN_APP_PATHS.filter(p => p.includes(`/${type}`))
  
  for (const possiblePath of possiblePaths) {
    const fullPath = path.resolve(__dirname, possiblePath)
    if (fs.existsSync(fullPath)) {
      console.log(`Found ${type} directory at: ${fullPath}`)
      return fullPath
    }
  }
  
  console.warn(`${type} directory not found in any of the possible locations`)
  return null
}

function extractToolsRegistry(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Registry file not found at ${filePath}`)
      return []
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(
      'index.ts',
      fileContent,
      ts.ScriptTarget.Latest,
      true
    )

    // Find the tools registry object
    const tools: string[] = []
    
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) && 
        node.name.getText() === 'tools' &&
        node.initializer && 
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        // Extract tool IDs from the object properties
        for (const property of node.initializer.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
            tools.push(property.name.text)
          }
        }
      }
      
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    console.log(`Extracted ${tools.length} tools from registry`)
    return tools
  } catch (error) {
    console.error('Error extracting tools from registry:', error)
    return []
  }
}

function extractBlocksRegistry(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Registry file not found at ${filePath}`)
      return []
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(
      'index.ts',
      fileContent,
      ts.ScriptTarget.Latest,
      true
    )

    // Find the blocks registry object
    const blocks: string[] = []
    
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) && 
        node.name.getText() === 'blocks' &&
        node.initializer && 
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        // Extract block IDs from the object properties
        for (const property of node.initializer.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
            blocks.push(property.name.text)
          }
        }
      }
      
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
    console.log(`Extracted ${blocks.length} blocks from registry`)
    return blocks
  } catch (error) {
    console.error('Error extracting blocks from registry:', error)
    return []
  }
}

function extractToolsFromDir(dirPath: string): Map<string, string[]> {
  const toolParams = new Map<string, string[]>()
  
  // Check subdirectories first
  const subdirs = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
  
  console.log(`Found ${subdirs.length} subdirectories in tools directory`)
  
  // Process each subdirectory
  for (const subdir of subdirs) {
    if (subdir === 'node_modules' || subdir === '__test-utils__') continue
    
    const subdirPath = path.join(dirPath, subdir)
    
    // Look for all .ts files (but not .test.ts)
    const files = fs.readdirSync(subdirPath)
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    
    for (const file of files) {
      const filePath = path.join(subdirPath, file)
      const extractedTools = extractToolDefinitionFromFile(filePath)
      
      // Merge the results
      for (const [toolId, params] of extractedTools.entries()) {
        toolParams.set(toolId, params)
      }
    }
  }
  
  // Also process root .ts files
  const rootFiles = fs.readdirSync(dirPath)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'index.ts')
  
  for (const file of rootFiles) {
    const filePath = path.join(dirPath, file)
    const extractedTools = extractToolDefinitionFromFile(filePath)
    
    // Merge the results
    for (const [toolId, params] of extractedTools.entries()) {
      toolParams.set(toolId, params)
    }
  }
  
  console.log(`Found tool definitions with required parameters for: ${Array.from(toolParams.keys()).join(', ')}`)
  return toolParams
}

function extractBlocksFromDir(dirPath: string): Map<string, string[]> {
  const blockParams = new Map<string, string[]>()
  
  // Check for blocks subdirectory specifically
  const blocksDir = path.join(dirPath, 'blocks')
  if (fs.existsSync(blocksDir) && fs.statSync(blocksDir).isDirectory()) {
    console.log('Found blocks subdirectory')
    
    // Look for all .ts files (but not .test.ts)
    const files = fs.readdirSync(blocksDir)
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    
    for (const file of files) {
      const filePath = path.join(blocksDir, file)
      const extractedBlocks = extractBlockDefinitionFromFile(filePath)
      
      // Merge the results
      for (const [blockId, params] of extractedBlocks.entries()) {
        blockParams.set(blockId, params)
      }
    }
  }
  
  // Also process root .ts files
  const rootFiles = fs.readdirSync(dirPath)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'index.ts')
  
  for (const file of rootFiles) {
    const filePath = path.join(dirPath, file)
    const extractedBlocks = extractBlockDefinitionFromFile(filePath)
    
    // Merge the results
    for (const [blockId, params] of extractedBlocks.entries()) {
      blockParams.set(blockId, params)
    }
  }
  
  console.log(`Found block definitions with required parameters for: ${Array.from(blockParams.keys()).join(', ')}`)
  return blockParams
}

function extractToolDefinitionFromFile(filePath: string): Map<string, string[]> {
  const toolParams = new Map<string, string[]>()
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      fileContent,
      ts.ScriptTarget.Latest,
      true
    )
    
    // Look for tool definitions (objects with id property)
    ts.forEachChild(sourceFile, node => {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
            let toolId = ''
            
            // Find the tool ID
            for (const prop of declaration.initializer.properties) {
              if (
                ts.isPropertyAssignment(prop) && 
                ts.isIdentifier(prop.name) && 
                prop.name.text === 'id' && 
                ts.isStringLiteral(prop.initializer)
              ) {
                toolId = prop.initializer.text
                break
              }
            }
            
            if (!toolId) continue
            
            // Find required parameters
            const requiredParams: string[] = []
            
            for (const prop of declaration.initializer.properties) {
              if (
                ts.isPropertyAssignment(prop) && 
                ts.isIdentifier(prop.name) && 
                (prop.name.text === 'params' || prop.name.text === 'parameters') && 
                ts.isObjectLiteralExpression(prop.initializer)
              ) {
                // Examine each parameter
                for (const param of prop.initializer.properties) {
                  if (ts.isPropertyAssignment(param) && ts.isIdentifier(param.name)) {
                    const paramName = param.name.text
                    
                    if (ts.isObjectLiteralExpression(param.initializer)) {
                      // Look for requiredForToolCall: true
                      for (const paramProp of param.initializer.properties) {
                        if (
                          ts.isPropertyAssignment(paramProp) && 
                          ts.isIdentifier(paramProp.name) && 
                          paramProp.name.text === 'requiredForToolCall' && 
                          (
                            (paramProp.initializer.kind === ts.SyntaxKind.TrueKeyword) ||
                            (ts.isStringLiteral(paramProp.initializer) && paramProp.initializer.text === 'true')
                          )
                        ) {
                          requiredParams.push(paramName)
                          console.log(`Found requiredForToolCall parameter '${paramName}' for tool '${toolId}' in ${filePath}`)
                          break
                        }
                      }
                    }
                  }
                }
              }
            }
            
            if (requiredParams.length > 0) {
              toolParams.set(toolId, [...new Set(requiredParams)])
            }
          }
        }
      }
    })
    
    return toolParams
  } catch (error) {
    console.error(`Error extracting tool definitions from ${filePath}:`, error)
    return toolParams
  }
}

function extractBlockDefinitionFromFile(filePath: string): Map<string, string[]> {
  const blockParams = new Map<string, string[]>()
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8')
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      fileContent,
      ts.ScriptTarget.Latest,
      true
    )
    
    // Look for block definitions (objects with type property)
    ts.forEachChild(sourceFile, node => {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
            let blockId = ''
            
            // Find the block type
            for (const prop of declaration.initializer.properties) {
              if (
                ts.isPropertyAssignment(prop) && 
                ts.isIdentifier(prop.name) && 
                prop.name.text === 'type' && 
                ts.isStringLiteral(prop.initializer)
              ) {
                blockId = prop.initializer.text
                break
              }
            }
            
            if (!blockId) continue
            
            // Find required parameters
            const requiredParams: string[] = []
            
            for (const prop of declaration.initializer.properties) {
              if (
                ts.isPropertyAssignment(prop) && 
                ts.isIdentifier(prop.name) && 
                prop.name.text === 'inputs' && 
                ts.isObjectLiteralExpression(prop.initializer)
              ) {
                // Examine each parameter
                for (const param of prop.initializer.properties) {
                  if (ts.isPropertyAssignment(param) && ts.isIdentifier(param.name)) {
                    const paramName = param.name.text
                    
                    if (ts.isObjectLiteralExpression(param.initializer)) {
                      // Look for required: true
                      for (const paramProp of param.initializer.properties) {
                        if (
                          ts.isPropertyAssignment(paramProp) && 
                          ts.isIdentifier(paramProp.name) && 
                          paramProp.name.text === 'required' && 
                          (
                            (paramProp.initializer.kind === ts.SyntaxKind.TrueKeyword) ||
                            (ts.isStringLiteral(paramProp.initializer) && paramProp.initializer.text === 'true')
                          )
                        ) {
                          requiredParams.push(paramName)
                          console.log(`Found required parameter '${paramName}' for block '${blockId}' in ${filePath}`)
                          break
                        }
                      }
                    }
                  }
                }
              }
            }
            
            if (requiredParams.length > 0) {
              blockParams.set(blockId, [...new Set(requiredParams)])
            }
          }
        }
      }
    })
    
    return blockParams
  } catch (error) {
    console.error(`Error extracting block definitions from ${filePath}:`, error)
    return blockParams
  }
}

function mergeToolsInfo(registry: string[], toolParams: Map<string, string[]>): { id: string, requiredParams: string[] }[] {
  return registry.map(id => ({
    id,
    requiredParams: toolParams.get(id) || []
  }))
}

function mergeBlocksInfo(registry: string[], blockParams: Map<string, string[]>): { id: string, requiredParams: string[] }[] {
  return registry.map(id => ({
    id,
    requiredParams: blockParams.get(id) || []
  }))
}

function generateRegistryFile(
  tools: { id: string, requiredParams: string[] }[], 
  blocks: { id: string, requiredParams: string[] }[]
) {
  const outputPath = path.resolve(__dirname, OUTPUT_REGISTRY_PATH)
  
  const content = `/**
 * This file is auto-generated. Do not edit directly.
 * Generated at ${new Date().toISOString()}
 */

/**
 * List of all available tools in the main application
 */
export const availableTools = ${JSON.stringify(tools.map(t => t.id), null, 2)}

/**
 * List of all available blocks in the main application
 */
export const availableBlocks = ${JSON.stringify(blocks.map(b => b.id), null, 2)}

/**
 * Map of tool IDs to their block types
 */
export const toolToBlockMap: Record<string, string> = {
  ${tools.map(tool => {
    // Convert tool_name to ToolNameBlock format
    const blockName = tool.id.split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'Block'
    return `  '${tool.id}': '${blockName}'`
  }).join(',\n')}
}

/**
 * Required parameters for each tool
 */
export const toolRequiredParameters: Record<string, string[]> = {
  ${tools.map(tool => `  '${tool.id}': ${JSON.stringify(tool.requiredParams)}`).join(',\n')}
}

/**
 * Required parameters for each block
 */
export const blockRequiredParameters: Record<string, string[]> = {
  ${blocks.map(block => `  '${block.id}': ${JSON.stringify(block.requiredParams)}`).join(',\n')}
}

/**
 * Check if a tool is available
 */
export function isToolAvailable(toolId: string): boolean {
  return availableTools.includes(toolId)
}

/**
 * Check if a block is available
 */
export function isBlockAvailable(blockId: string): boolean {
  return availableBlocks.includes(blockId)
}

/**
 * Get the block type for a tool
 */
export function getBlockTypeForTool(toolId: string): string | undefined {
  return toolToBlockMap[toolId]
}

/**
 * Get required parameters for a tool
 */
export function getToolRequiredParameters(toolId: string): string[] {
  return toolRequiredParameters[toolId] || []
}

/**
 * Get required parameters for a block
 */
export function getBlockRequiredParameters(blockId: string): string[] {
  return blockRequiredParameters[blockId] || []
}
`

  fs.writeFileSync(outputPath, content)
  console.log(`Generated registry file at ${outputPath}`)
}

// Run the sync if this file is executed directly
if (require.main === module) {
  syncFromMainApp().catch(console.error)
} 