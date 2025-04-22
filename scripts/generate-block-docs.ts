#!/usr/bin/env node
// @ts-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'

console.log("Starting documentation generator...")

// Define directory paths
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// Paths configuration
const BLOCKS_PATH = path.join(rootDir, 'sim/blocks/blocks')
const DOCS_OUTPUT_PATH = path.join(rootDir, 'docs/content/docs/tools')
const ICONS_PATH = path.join(rootDir, 'sim/components/icons.tsx')

// Make sure the output directory exists
if (!fs.existsSync(DOCS_OUTPUT_PATH)) {
  fs.mkdirSync(DOCS_OUTPUT_PATH, { recursive: true })
}

// Type for block input config
interface InputConfig {
  type: string
  required: boolean
}

// Type for block output config
interface OutputConfig {
  type: string | Record<string, any>
}

// Basic interface for BlockConfig to avoid import issues
interface BlockConfig {
  type: string
  name: string
  description: string
  longDescription?: string
  category: string
  bgColor?: string
  icon?: any
  subBlocks?: Array<{
    id: string
    title?: string
    placeholder?: string
    type?: string
    layout?: string
    options?: Array<{ label: string; id: string }>
    [key: string]: any
  }>
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  tools?: {
    access?: string[]
    config?: any
  }
  [key: string]: any
}

// Function to extract SVG icons from icons.tsx file
function extractIcons(): Record<string, string> {
  try {
    const iconsContent = fs.readFileSync(ICONS_PATH, 'utf-8')
    const icons: Record<string, string> = {}
    
    // Match both function declaration and arrow function export patterns
    const functionDeclarationRegex = /export\s+function\s+(\w+Icon)\s*\([^)]*\)\s*{[\s\S]*?return\s*\(\s*<svg[\s\S]*?<\/svg>\s*\)/g
    const arrowFunctionRegex = /export\s+const\s+(\w+Icon)\s*=\s*\([^)]*\)\s*=>\s*(\(?\s*<svg[\s\S]*?<\/svg>\s*\)?)/g
    
    // Extract function declaration style icons
    const functionMatches = Array.from(iconsContent.matchAll(functionDeclarationRegex))
    for (const match of functionMatches) {
      const iconName = match[1]
      const svgMatch = match[0].match(/<svg[\s\S]*?<\/svg>/)
      
      if (iconName && svgMatch) {
        // Clean the SVG to remove {...props} and standardize size
        let svgContent = svgMatch[0]
        svgContent = svgContent.replace(/{\.\.\.props}/g, '')
        svgContent = svgContent.replace(/{\.\.\.(props|rest)}/g, '')
        // Remove any existing width/height attributes to let CSS handle sizing
        svgContent = svgContent.replace(/width=["'][^"']*["']/g, '')
        svgContent = svgContent.replace(/height=["'][^"']*["']/g, '')
        // Add className for styling
        svgContent = svgContent.replace(/<svg/, '<svg className="block-icon"')
        icons[iconName] = svgContent
      }
    }
    
    // Extract arrow function style icons
    const arrowMatches = Array.from(iconsContent.matchAll(arrowFunctionRegex))
    for (const match of arrowMatches) {
      const iconName = match[1]
      const svgContent = match[2]
      const svgMatch = svgContent.match(/<svg[\s\S]*?<\/svg>/)
      
      if (iconName && svgMatch) {
        // Clean the SVG to remove {...props} and standardize size
        let cleanedSvg = svgMatch[0]
        cleanedSvg = cleanedSvg.replace(/{\.\.\.props}/g, '')
        cleanedSvg = cleanedSvg.replace(/{\.\.\.(props|rest)}/g, '')
        // Remove any existing width/height attributes to let CSS handle sizing
        cleanedSvg = cleanedSvg.replace(/width=["'][^"']*["']/g, '')
        cleanedSvg = cleanedSvg.replace(/height=["'][^"']*["']/g, '')
        // Add className for styling
        cleanedSvg = cleanedSvg.replace(/<svg/, '<svg className="block-icon"')
        icons[iconName] = cleanedSvg
      }
    }
    return icons
  } catch (error) {
    console.error('Error extracting icons:', error)
    return {}
  }
}

// Function to extract block configuration from file content
function extractBlockConfig(fileContent: string): BlockConfig | null {
  try {
    // Match the block name and type from imports and export statement
    const typeMatch = fileContent.match(/type\s+(\w+)Response\s*=/)
    const exportMatch = fileContent.match(/export\s+const\s+(\w+)Block\s*:/)
    
    if (!exportMatch) {
      console.warn('No block export found in file')
      return null
    }

    const blockName = exportMatch[1]
    const blockType = findBlockType(fileContent, blockName)
    
    // Extract individual properties with more robust regex
    const name = extractStringProperty(fileContent, 'name') || `${blockName} Block`
    const description = extractStringProperty(fileContent, 'description') || ''
    const longDescription = extractStringProperty(fileContent, 'longDescription') || ''
    const category = extractStringProperty(fileContent, 'category') || 'misc'
    const bgColor = extractStringProperty(fileContent, 'bgColor') || '#F5F5F5'
    const iconName = extractIconName(fileContent) || ''
    
    // Extract subBlocks array
    const subBlocks = extractSubBlocks(fileContent)
    
    // Extract inputs object
    const inputs = extractInputs(fileContent)
    
    // Extract outputs object with better handling
    const outputs = extractOutputs(fileContent)
    
    // Extract tools access array
    const toolsAccess = extractToolsAccess(fileContent)
    
    return {
      type: blockType || blockName.toLowerCase(),
      name,
      description,
      longDescription,
      category,
      bgColor,
      iconName,
      subBlocks,
      inputs,
      outputs,
      tools: {
        access: toolsAccess
      }
    }
  } catch (error) {
    console.error('Error extracting block configuration:', error)
    return null
  }
}

// Helper function to find the block type
function findBlockType(content: string, blockName: string): string {
  // Try to find explicitly defined type
  const typeMatch = content.match(/type\s*:\s*['"]([^'"]+)['"]/)
  if (typeMatch) return typeMatch[1]
  
  // Convert CamelCase to snake_case as fallback
  return blockName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

// Helper to extract a string property from content
function extractStringProperty(content: string, propName: string): string | null {
  const simpleMatch = content.match(new RegExp(`${propName}\\s*:\\s*['"]([^'"]+)['"]`, 'm'))
  if (simpleMatch) return simpleMatch[1]
  
  // Try to match multi-line string with template literals
  const templateMatch = content.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 'm'))
  return templateMatch ? templateMatch[1] : null
}

// Helper to extract icon name from content
function extractIconName(content: string): string | null {
  const iconMatch = content.match(/icon\s*:\s*(\w+Icon)/)
  return iconMatch ? iconMatch[1] : null
}

// Helper to extract subBlocks array
function extractSubBlocks(content: string): any[] {
  const subBlocksMatch = content.match(/subBlocks\s*:\s*\[([\s\S]*?)\s*\],/)
  if (!subBlocksMatch) return []
  
  const subBlocksContent = subBlocksMatch[1]
  const blocks: any[] = []
  
  // Find all block objects
  const blockMatches = subBlocksContent.match(/{\s*id\s*:[^}]*}/g)
  if (!blockMatches) return []
  
  blockMatches.forEach(blockText => {
    const id = extractStringProperty(blockText, 'id')
    const title = extractStringProperty(blockText, 'title')
    const placeholder = extractStringProperty(blockText, 'placeholder')
    const type = extractStringProperty(blockText, 'type')
    const layout = extractStringProperty(blockText, 'layout')
    
    // Extract options array if present
    const optionsMatch = blockText.match(/options\s*:\s*\[([\s\S]*?)\]/)
    let options: Array<{ label: string | null; id: string | null }> = []
    
    if (optionsMatch) {
      const optionsText = optionsMatch[1]
      const optionMatches = optionsText.match(/{\s*label\s*:[^}]*}/g)
      
      if (optionMatches) {
        options = optionMatches.map(optText => {
          const label = extractStringProperty(optText, 'label')
          const optId = extractStringProperty(optText, 'id')
          return { label, id: optId }
        })
      }
    }
    
    blocks.push({
      id,
      title,
      placeholder,
      type,
      layout,
      options: options.length > 0 ? options : undefined
    })
  })
  
  return blocks
}

// Function to extract inputs object
function extractInputs(content: string): Record<string, any> {
  const inputsMatch = content.match(/inputs\s*:\s*{([\s\S]*?)},/)
  if (!inputsMatch) return {}
  
  const inputsContent = inputsMatch[1]
  const inputs: Record<string, any> = {}
  
  // Find all input property definitions
  const propMatches = inputsContent.match(/(\w+)\s*:\s*{[^}]*}/g)
  if (!propMatches) {
    // Try an alternative approach for the whole inputs section
    const inputLines = inputsContent.split('\n')
    inputLines.forEach(line => {
      const propMatch = line.match(/\s*(\w+)\s*:\s*{/)
      if (propMatch) {
        const propName = propMatch[1]
        const typeMatch = line.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = line.match(/required\s*:\s*(true|false)/)
        
        inputs[propName] = {
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false
      }
      }
    })
    
    return inputs
  }
  
  propMatches.forEach(propText => {
    const propMatch = propText.match(/(\w+)\s*:/)
    if (!propMatch) return
    
    const propName = propMatch[1]
    const typeMatch = propText.match(/type\s*:\s*['"]?([^'"}, ]+)['"]?/)
    const requiredMatch = propText.match(/required\s*:\s*(true|false)/)
    
    inputs[propName] = {
      type: typeMatch ? typeMatch[1] : 'any',
      required: requiredMatch ? requiredMatch[1] === 'true' : false
    }
  })
  
  return inputs
}

// Updated function to extract outputs with a simpler and more reliable approach
function extractOutputs(content: string): Record<string, any> {
  // Look for the outputs section with a more resilient regex
  const outputsSection = content.match(/outputs\s*:\s*{([^}]*response[^}]*)}(?:\s*,|\s*})/s)
  
  if (outputsSection) {
    
    // Find the response type definition
    const responseTypeMatch = content.match(/response\s*:\s*{\s*type\s*:\s*{([^}]*)}/s)
    
    if (responseTypeMatch) {
      const typeContent = responseTypeMatch[1]
      
      // Extract all field: 'type' pairs regardless of comments or formatting
      const fieldMatches = typeContent.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)
      
      if (fieldMatches && fieldMatches.length > 0) {
        const typeFields: Record<string, string> = {}
        
        // Process each field match
        fieldMatches.forEach(match => {
          const fieldParts = match.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/)
          if (fieldParts) {
            const fieldName = fieldParts[1]
            const fieldType = fieldParts[2]
            typeFields[fieldName] = fieldType
          }
        })
        
        // If we have any fields, return them in the expected structure
        if (Object.keys(typeFields).length > 0) {
          const result = {
            response: {
              type: typeFields
            }
          }
          return result
        }
      }
    }
  }

  return {}
}

// Helper to extract tools access array
function extractToolsAccess(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*((?:['"][^'"]+['"](?:\s*,\s*)?)+)\s*\]/)
  if (!accessMatch) return []
  
  const accessContent = accessMatch[1]
  const tools: string[] = []
  
  const toolMatches = accessContent.match(/['"]([^'"]+)['"]/g)
  if (toolMatches) {
    toolMatches.forEach(toolText => {
      const match = toolText.match(/['"]([^'"]+)['"]/)
              if (match) {
        tools.push(match[1])
      }
    })
  }
  
  return tools
}

// Function to extract tool information from file content
function extractToolInfo(toolName: string, fileContent: string, filePath: string = ''): {
  description: string
  params: Array<{name: string; type: string; required: boolean; description: string}>
  outputs: Record<string, any>
} | null {
  try {
    // Extract tool config section - Update regex to handle more naming patterns
    const toolConfigRegex = new RegExp(`(?:export const [\\w]+Tool|const [\\w]+Tool|export const [\\w]+: ToolConfig|export const \\w+${toolName.split('_').pop()}Tool)\\s*[=<][^{]*{[\\s\\S]*?params\\s*:\\s*{([\\s\\S]*?)}`, 'im')
    const toolConfigMatch = fileContent.match(toolConfigRegex)
    
    // Extract description
    const descriptionRegex = /description\s*:\s*['"]([^'"]+)['"].*/
    const descriptionMatch = fileContent.match(descriptionRegex)
    const description = descriptionMatch ? descriptionMatch[1] : 'No description available'
    
    // Parse parameters
    const params: Array<{name: string; type: string; required: boolean; description: string}> = []
    
    if (toolConfigMatch) {
      const paramsContent = toolConfigMatch[1]
      const paramRegex = /(\w+)\s*:\s*{([^}]*)}/g
      let paramMatch
      
      while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        const paramContent = paramMatch[2]
        
        const typeMatch = paramContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = paramContent.match(/required\s*:\s*(true|false)/)
        const descriptionMatch = paramContent.match(/description\s*:\s*['"]([^'"]+)['"]/)
        
        params.push({
          name: paramName,
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
          description: descriptionMatch ? descriptionMatch[1] : ''
        })
      }
    }
    
    // If no params were found with the first regex, try a more targeted approach
    if (params.length === 0) {
      // Look for the params section directly
      const paramsRegex = new RegExp(`id\\s*:\\s*['"]${toolName}['"][\\s\\S]*?params\\s*:\\s*{([\\s\\S]*?)},`, 'm')
      const paramsMatch = fileContent.match(paramsRegex)
      
      if (paramsMatch) {
        const paramsContent = paramsMatch[1]
        // Split by property definitions and process each
        const paramLines = paramsContent.split(/},\s*\n\s*\w+:\s*{/)
        
        for (const line of paramLines) {
          // Extract param name
          const nameMatch = line.match(/(\w+)\s*:\s*{/) || line.match(/^\s*(\w+)\s*:/)
          if (!nameMatch) continue
          
          const paramName = nameMatch[1]
          
          // Extract type, required, and description
          const typeMatch = line.match(/type\s*:\s*['"]([^'"]+)['"]/)
          const requiredMatch = line.match(/required\s*:\s*(true|false)/)
          const descriptionMatch = line.match(/description\s*:\s*['"]([^'"]+)['"]/)
          
          params.push({
            name: paramName,
            type: typeMatch ? typeMatch[1] : 'string',
            required: requiredMatch ? requiredMatch[1] === 'true' : false,
            description: descriptionMatch ? descriptionMatch[1] : ''
          })
        }
      }
    }
    
    // Extract output structure from transformResponse
    let outputs: Record<string, any> = {}
    const outputRegex = /transformResponse[\s\S]*?return\s*{[\s\S]*?output\s*:\s*{([^}]*)/
    const outputMatch = fileContent.match(outputRegex)
    
    if (outputMatch) {
      const outputContent = outputMatch[1]
      // Try to parse the output structure based on the content
      outputs = parseOutputStructure(toolName, outputContent, fileContent)
    }
    
    // If we couldn't extract outputs from transformResponse, try an alternative approach
    if (Object.keys(outputs).length === 0) {
      // Look for output in successful response in transformResponse
      const successOutputRegex = /success\s*:\s*true,\s*output\s*:\s*(\{[^}]*\}|\w+(\.\w+)+\s*\|\|\s*\{[^}]*\})/
      const successOutputMatch = fileContent.match(successOutputRegex)
      
      if (successOutputMatch) {
        const outputExpression = successOutputMatch[1].trim();
        
        // Handle case where output is something like "data.data || {}"
        if (outputExpression.includes('||')) {
          outputs.data = 'json';
        }
        // Handle direct object assignment like "output: { field1, field2 }"
        else if (outputExpression.startsWith('{')) {
          const fieldMatches = outputExpression.match(/(\w+)\s*:/g);
          if (fieldMatches) {
            fieldMatches.forEach(match => {
              const fieldName = match.trim().replace(':', '');
              outputs[fieldName] = 'Dynamic output field';
            });
          }
        }
        // Check for data.X patterns like "data.data"
        else if (outputExpression.includes('.')) {
          const fieldName = outputExpression.split('.').pop();
          if (fieldName) {
            outputs[fieldName] = 'json';
          }
        }
      }
    }
    
    // Try to extract TypeScript interface for outputs as a fallback
    if (Object.keys(outputs).length === 0) {
      const interfaceRegex = new RegExp(`interface\\s+${toolName.replace(/_/g, '')}Response\\s*{[\\s\\S]*?output\\s*:\\s*{([\\s\\S]*?)}[\\s\\S]*?}`)
      const interfaceMatch = fileContent.match(interfaceRegex)
      
      if (interfaceMatch) {
        const interfaceContent = interfaceMatch[1]
        outputs = parseOutputStructure(toolName, interfaceContent, fileContent)
      }
    }
    
    // Look for TypeScript types in a types.ts file if available
    if (Object.keys(outputs).length === 0 && filePath) {
      const toolDir = path.dirname(filePath)
      const typesPath = path.join(toolDir, 'types.ts')
      if (fs.existsSync(typesPath)) {
        const typesContent = fs.readFileSync(typesPath, 'utf-8')
        const responseTypeRegex = new RegExp(`interface\\s+${toolName.replace(/_/g, '')}Response\\s*extends\\s+\\w+\\s*{\\s*output\\s*:\\s*{([\\s\\S]*?)}\\s*}`, 'i')
        const responseTypeMatch = typesContent.match(responseTypeRegex)
        
        if (responseTypeMatch) {
          outputs = parseOutputStructure(toolName, responseTypeMatch[1], typesContent)
        }
      }
    }
    
    return {
      description,
      params,
      outputs
    }
  } catch (error) {
    console.error(`Error extracting info for tool ${toolName}:`, error)
    return null
  }
}

// Update the parseOutputStructure function to better handle nested objects
function parseOutputStructure(toolName: string, outputContent: string, fileContent: string): Record<string, any> {
  const outputs: Record<string, any> = {}
  
  // Try to extract field declarations with their types
  const fieldRegex = /(\w+)\s*:([^,}]+)/g
  let fieldMatch
  
  while ((fieldMatch = fieldRegex.exec(outputContent)) !== null) {
    const fieldName = fieldMatch[1].trim()
    const fieldType = fieldMatch[2].trim().replace(/['"\[\]]/g, '')
    
    // Determine a good description based on field name
    let description = 'Dynamic output field'
    
    if (fieldName === 'results' || fieldName === 'memories' || fieldName === 'searchResults') {
      description = `${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} from the operation`
    } else if (fieldName === 'ids') {
      description = 'IDs of created or retrieved resources'
    } else if (fieldName === 'answer') {
      description = 'Generated answer text'
    } else if (fieldName === 'citations') {
      description = 'References used to generate the answer'
    }
    
    outputs[fieldName] = description
  }
  
  // Try to identify common patterns based on tool types
  if (Object.keys(outputs).length === 0) {
    if (toolName.includes('_search')) {
      outputs.results = 'Array of search results'
    } else if (toolName.includes('_answer')) {
      outputs.answer = 'Generated answer text'
      outputs.citations = 'References used to generate the answer'
    } else if (toolName.includes('_add')) {
      outputs.ids = 'IDs of created resources'
    } else if (toolName.includes('_get')) {
      outputs.data = 'Retrieved data'
    } else {
      // Try to extract field names from the output content with a simpler regex
      const simpleFieldsRegex = /(\w+)\s*:/g
      let simpleFieldMatch
      
      while ((simpleFieldMatch = simpleFieldsRegex.exec(outputContent)) !== null) {
        outputs[simpleFieldMatch[1]] = 'Dynamic output field'
      }
    }
  }
  
  return outputs
}

// Find and extract information about a tool
async function getToolInfo(toolName: string): Promise<{
  description: string
  params: Array<{name: string; type: string; required: boolean; description: string}>
  outputs: Record<string, any>
} | null> {
  try {
    // Get tool prefix and suffix
    let toolPrefix = toolName.split('_')[0]
    let toolSuffix = toolName.split('_').slice(1).join('_')

    // Handle special cases for Google tools
    if (toolPrefix === 'google' && (toolName.startsWith('google_docs_') || toolName.startsWith('google_sheets_') || toolName.startsWith('google_drive_'))) {
      toolPrefix = toolName.split('_').slice(0, 2).join('_')
      toolSuffix = toolName.split('_').slice(2).join('_')
    }
    
    // Special case handling for known tool naming patterns
    let toolFileBaseName = toolSuffix
    
    // Generate possible tool file names based on common patterns
    const possibleFileNames = [
      `${toolFileBaseName}.ts`,
      `${toolSuffix}.ts`,
      `${toolName}.ts`,
      `${toolSuffix.charAt(0).toUpperCase() + toolSuffix.slice(1)}.ts`,
      `${toolPrefix}${toolSuffix.charAt(0).toUpperCase() + toolSuffix.slice(1)}.ts`
    ]
    
    // Common locations for tool files
    const possibleLocations = []
    
    // Add various combinations of folder and file names
    for (const fileName of possibleFileNames) {
      possibleLocations.push(path.join(rootDir, `sim/tools/${toolPrefix}/${fileName}`))
    }
    
    // Also try standard paths
    possibleLocations.push(
      path.join(rootDir, `sim/tools/${toolPrefix}/index.ts`),
      path.join(rootDir, `sim/tools/${toolName}.ts`)
    )
    
    // Try to find the tool definition file
    let toolFilePath = ''
    let toolFileContent = ''
    
    for (const location of possibleLocations) {
      if (fs.existsSync(location)) {
        toolFilePath = location
        toolFileContent = fs.readFileSync(location, 'utf-8')
      
        break
      }
    }
    
    // If not found, search more broadly in the tools directory
    if (!toolFileContent) {
      const toolsDir = path.join(rootDir, 'sim/tools')
      const toolDirs = fs.readdirSync(toolsDir).filter(dir => 
        fs.statSync(path.join(toolsDir, dir)).isDirectory() && dir !== '__test-utils__'
      )
      
      for (const dir of toolDirs) {
        const dirPath = path.join(toolsDir, dir)
        const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.ts'))
        
        for (const file of files) {
          const filePath = path.join(dirPath, file)
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // Check for various patterns that might identify this as the right tool
          if (
            content.includes(`id: '${toolName}'`) || 
            content.includes(`id: "${toolName}"`) ||
            content.includes(`export const ${toolSuffix}Tool`) ||
            content.includes(`const ${toolSuffix}Tool`) ||
            content.includes(`export const ${toolPrefix}${toolSuffix.charAt(0).toUpperCase() + toolSuffix.slice(1)}Tool`) ||
            content.includes(`export const ${toolPrefix}${toolFileBaseName}Tool`)
          ) {
            toolFilePath = filePath
            toolFileContent = content
            
            break
          }
        }
        
        if (toolFileContent) break
      }
    }
    
    if (!toolFileContent) {
      // Try looking for imports and exports directly in sim/tools/index.ts
      const toolsIndexPath = path.join(rootDir, 'sim/tools/index.ts')
      if (fs.existsSync(toolsIndexPath)) {
        const indexContent = fs.readFileSync(toolsIndexPath, 'utf-8')
        if (indexContent.includes(toolName)) {
          // In this case, we might find tool details in registry.ts
          const registryPath = path.join(rootDir, 'sim/tools/registry.ts')
          if (fs.existsSync(registryPath)) {
            toolFilePath = registryPath
            toolFileContent = fs.readFileSync(registryPath, 'utf-8')
          }
        }
      }
    }
    
    if (!toolFileContent) {
      console.warn(`Could not find definition for tool: ${toolName}`)
      return null
    }
    
    // For special case tools like Mem0, try direct extraction from file
    if (toolPrefix === 'mem0') {
      // Try direct extraction for mem0 tools
      return extractMem0ToolInfo(toolName, toolFileContent, toolFilePath)
    }
    
    // Extract tool information from the file
    return extractToolInfo(toolName, toolFileContent, toolFilePath)
  } catch (error) {
    console.error(`Error getting info for tool ${toolName}:`, error)
    return null
  }
}

// Special function to extract Mem0 tool info using direct content analysis
function extractMem0ToolInfo(toolName: string, fileContent: string, filePath: string = ''): {
  description: string
  params: Array<{name: string; type: string; required: boolean; description: string}>
  outputs: Record<string, any>
} | null {
  try {
    // Extract description
    const descriptionRegex = /description\s*:\s*['"]([^'"]+)['"].*/
    const descriptionMatch = fileContent.match(descriptionRegex)
    const description = descriptionMatch ? descriptionMatch[1] : 'No description available'
    
    // Extract parameters section
    const paramsRegex = /params\s*:\s*{([^}]*?)},/s
    const paramsMatch = fileContent.match(paramsRegex)
    
    const params: Array<{name: string; type: string; required: boolean; description: string}> = []
    
    if (paramsMatch) {
      const paramsContent = paramsMatch[1]
      
      // Match individual param blocks
      const paramBlockRegex = /(\w+)\s*:\s*{([^}]+)}/gs
      let paramMatch
      
      while ((paramMatch = paramBlockRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        const paramBlock = paramMatch[2]
        
        // Extract parameter details
        const typeMatch = paramBlock.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = paramBlock.match(/required\s*:\s*(true|false)/)
        const descriptionMatch = paramBlock.match(/description\s*:\s*['"]([^'"]+)['"]/)
        
        params.push({
          name: paramName,
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
          description: descriptionMatch ? descriptionMatch[1] : ''
        })
      }
    }
    
    // If no params were found, look for params in a different format
    if (params.length === 0) {
      // Try a more direct approach
      const simpleParamRegex = /(\w+)\s*:\s*{[^}]*type\s*:\s*['"]([^'"]+)['"][^}]*required\s*:\s*(true|false)[^}]*description\s*:\s*['"]([^'"]+)['"][^}]*}/g
      let simpleMatch
      
      while ((simpleMatch = simpleParamRegex.exec(fileContent)) !== null) {
        params.push({
          name: simpleMatch[1],
          type: simpleMatch[2],
          required: simpleMatch[3] === 'true',
          description: simpleMatch[4]
        })
      }
    }
    
    // Extract output fields
    let outputs: Record<string, any> = {}
    
    // Look for output definition in transformResponse
    const outputRegex = /output\s*:\s*{([^}]*)}/s
    const outputMatch = fileContent.match(outputRegex)
    
    if (outputMatch) {
      const outputContent = outputMatch[1]
      
      // Extract field names
      const fieldRegex = /(\w+)\s*:/g
      let fieldMatch
      
      while ((fieldMatch = fieldRegex.exec(outputContent)) !== null) {
        const fieldName = fieldMatch[1]
        
        // Give descriptive names based on the tool and field
        if (fieldName === 'ids') {
          outputs[fieldName] = 'IDs of created or retrieved memories'
        } else if (fieldName === 'memories') {
          outputs[fieldName] = 'Retrieved memory objects'
        } else if (fieldName === 'searchResults') {
          outputs[fieldName] = 'Search results matching the query'
        } else {
          outputs[fieldName] = `${fieldName} from the operation`
        }
      }
    }
    
    // If we still have no outputs, try a different approach
    if (Object.keys(outputs).length === 0) {
      if (toolName === 'mem0_add_memories') {
        outputs.ids = 'IDs of created memories'
        outputs.memories = 'Array of created memory objects'
      } else if (toolName === 'mem0_search_memories') {
        outputs.searchResults = 'Array of memories matching the search query'
      } else if (toolName === 'mem0_get_memories') {
        outputs.memories = 'Array of retrieved memory objects'
      }
    }
    
    return {
      description,
      params,
      outputs
    }
  } catch (error) {
    console.error(`Error extracting Mem0 info for ${toolName}:`, error)
    return null
  }
}

// Function to generate documentation for a block
async function generateBlockDoc(blockPath: string, icons: Record<string, string>) {
  try {
    // Extract the block name from the file path
    const blockFileName = path.basename(blockPath, '.ts')
    if (blockFileName.endsWith('.test')) {
      return // Skip test files
    }
    
    // Read the file content
    const fileContent = fs.readFileSync(blockPath, 'utf-8')
    
    // Extract block configuration from the file content
    const blockConfig = extractBlockConfig(fileContent)
    
    if (!blockConfig || !blockConfig.type) {
      console.warn(`Skipping ${blockFileName} - not a valid block config`)
      return
    }
    
    // Skip blocks with category 'blocks', only process blocks with category 'tools', and skip specific blocks
    if (blockConfig.category === 'blocks' || blockConfig.type === 'evaluator' || blockConfig.type === 'number') {
      return
    }
    
    // Create the markdown content - now async
    const markdown = await generateMarkdownForBlock(blockConfig, icons)
    
    // Write the markdown file
    const outputFilePath = path.join(DOCS_OUTPUT_PATH, `${blockConfig.type}.mdx`)
    fs.writeFileSync(outputFilePath, markdown)

  } catch (error) {
    console.error(`Error processing ${blockPath}:`, error)
  }
}

// Make generateMarkdownForBlock async
async function generateMarkdownForBlock(blockConfig: BlockConfig, icons: Record<string, string>): Promise<string> {
  const {
    type,
    name,
    description,
    longDescription,
    category,
    bgColor,
    iconName,
    subBlocks = [],
    inputs = {},
    outputs = {},
    tools = { access: [], config: {} }
  } = blockConfig

  // Get SVG icon if available
  const iconSvg = iconName && icons[iconName] ? icons[iconName] : null

  // Create inputs table content with better descriptions
  let inputsTable = ''
  
  if (Object.keys(inputs).length > 0) {
    inputsTable = Object.entries(inputs).map(([key, config]) => {
      const inputConfig = config as InputConfig
      const subBlock = subBlocks.find(sb => sb.id === key)
      
      let description = subBlock?.title || ''
      if (subBlock?.placeholder) {
        description += description ? ` - ${subBlock.placeholder}` : subBlock.placeholder
      }
      
      if (subBlock?.options) {
        let optionsList = ''
        if (Array.isArray(subBlock.options) && subBlock.options.length > 0) {
          if (typeof subBlock.options[0] === 'string') {
            // String array options
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'string')
              .map(opt => `\`${opt}\``)
              .join(', ')
          } else {
            // Object array options with id/label
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'object' && opt !== null && 'id' in opt)
              .map(opt => {
                const option = opt as any
                return `\`${option.id}\` (${option.label || option.id})`
              })
              .join(', ')
          }
        }
        description += optionsList ? `: ${optionsList}` : ''
      }
      
      return `| \`${key}\` | ${inputConfig.type || 'string'} | ${inputConfig.required ? 'Yes' : 'No'} | ${description} |`
    }).join('\n')
  } else if (subBlocks.length > 0) {
    // If we have subBlocks but no inputs mapping, try to create the table from subBlocks
    inputsTable = subBlocks.map(subBlock => {
      const id = subBlock.id || ''
      const title = subBlock.title || ''
      const type = subBlock.type || 'string'
      const required = !!subBlock.condition ? 'No' : 'Yes'
      
      let description = title
      if (subBlock.placeholder) {
        description += title ? ` - ${subBlock.placeholder}` : subBlock.placeholder
      }
      
      if (subBlock.options) {
        let optionsList = ''
        if (Array.isArray(subBlock.options) && subBlock.options.length > 0) {
          if (typeof subBlock.options[0] === 'string') {
            // String array options
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'string')
              .map(opt => `\`${opt}\``)
              .join(', ')
          } else {
            // Object array options with id/label
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'object' && opt !== null && 'id' in opt)
              .map(opt => {
                const option = opt as any
                return `\`${option.id}\` (${option.label || option.id})`
              })
              .join(', ')
          }
        }
        description += optionsList ? `: ${optionsList}` : ''
      }
      
      return `| \`${id}\` | ${type} | ${required} | ${description} |`
    }).join('\n')
  }

  // Create detailed options section for dropdowns
  const dropdownBlocks = subBlocks.filter(sb => 
    (sb.type === 'dropdown' || sb.options) && 
    Array.isArray(sb.options) && 
    sb.options.length > 0
  )
  
  let optionsSection = ''
  if (dropdownBlocks.length > 0) {
    optionsSection = `## Available Options\n\n`
    
    dropdownBlocks.forEach(sb => {
      optionsSection += `### ${sb.title || sb.id} (${sb.id ? `\`${sb.id}\`` : ''})\n\n`
      
      if (Array.isArray(sb.options)) {
        // Check the first item to determine the array type
        if (sb.options.length > 0) {
          if (typeof sb.options[0] === 'string') {
            // Handle string array
            sb.options.forEach((opt) => {
              if (typeof opt === 'string') {
                optionsSection += `- \`${opt}\`\n`
              }
            })
          } else {
            // Handle object array with id/label properties
            sb.options.forEach((opt) => {
              if (typeof opt === 'object' && opt !== null && 'id' in opt) {
                const option = opt as any
                optionsSection += `- \`${option.id}\`: ${option.label || option.id}\n`
              }
            })
          }
        }
      }
      
      optionsSection += '\n'
    })
  }

  // Create outputs section with better handling of complex types
  let outputsSection = ''

  if (outputs && Object.keys(outputs).length > 0) {
    // Start with a better heading
    outputsSection = `## Outputs\n\n`
    
    // Process each output field (usually just 'response')
    outputsSection += Object.entries(outputs).map(([key, config]) => {
      const outputConfig = config as OutputConfig
      let outputContent = ''
      
      // Handle different output type formats
      if (typeof outputConfig.type === 'string') {
        // Simple string type
        outputContent = `The \`${key}\` output has type \`${outputConfig.type}\`.`
      } else if (outputConfig.type && typeof outputConfig.type === 'object') {
        // Output has complex structure with fields - create a table
        outputContent = `The \`${key}\` output contains the following fields:\n\n`
        outputContent += `| Field | Type |\n`
        outputContent += `| ----- | ---- |\n`
        
        // Add each field to the table
        Object.entries(outputConfig.type).forEach(([fieldName, fieldType]) => {
          let description = ''
          
          // Try to provide more descriptive explanations based on field name
          if (fieldName === 'results') {
            description = 'Array of search results containing titles, URLs, and content snippets'
          } else if (fieldName === 'similarLinks') {
            description = 'Array of similar URLs with relevance scores'
          } else if (fieldName === 'answer') {
            description = 'Generated text response to the question'
          } else if (fieldName === 'citations') {
            description = 'Sources referenced to generate the answer'
      } else {
            description = `Output field of type ${fieldType}`
          }
          
          outputContent += `| \`${fieldName}\` | \`${fieldType}\` |\n`
        })
        
        // If the block has an operation field, add a note about operation-dependent outputs
        if (subBlocks.some(sb => sb.id === 'operation')) {
          outputContent += `\n**Note:** The actual fields returned will depend on the selected operation.\n`
        }
  } else {
        // For any other case
        outputContent = 'Complex output structure.'
      }
      
      return outputContent
    }).join('\n\n')
  } else {
    outputsSection = 'This block does not produce any outputs.'
  }

  // Create tools section with more details
  let toolsSection = ''
  if (tools.access?.length) {
    toolsSection = `## Tools\n\n`
    
    // For each tool, try to find its definition and extract parameter information
    for (const tool of tools.access) {
      toolsSection += `### \`${tool}\`\n\n`
      
      // Get dynamic tool information
      const toolInfo = await getToolInfo(tool)
      
      if (toolInfo) {
        if (toolInfo.description && toolInfo.description !== 'No description available') {
          toolsSection += `${toolInfo.description}\n\n`
        }
        
        // Add Input Parameters section for the tool
        toolsSection += `#### Input Parameters\n\n`
        toolsSection += `| Parameter | Type | Required | Description |\n`
        toolsSection += `| --------- | ---- | -------- | ----------- |\n`
        
        if (toolInfo.params.length > 0) {
          // Use dynamically extracted parameters
          for (const param of toolInfo.params) {
            toolsSection += `| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description || 'No description'} |\n`
          }
        }
        
        // Add Output Parameters section for the tool
        toolsSection += `\n#### Output\n\n`
        
        if (Object.keys(toolInfo.outputs).length > 0) {
          // Use dynamically extracted outputs in table format
          toolsSection += `| Parameter | Type |\n`
          toolsSection += `| --------- | ---- |\n`
          for (const [key, value] of Object.entries(toolInfo.outputs)) {
            // Try to determine a reasonable type from the value description
            let inferredType = 'string'
            if (value.toLowerCase().includes('array')) inferredType = 'array'
            if (value.toLowerCase().includes('json')) inferredType = 'json'
            if (value.toLowerCase().includes('number')) inferredType = 'number'
            if (value.toLowerCase().includes('boolean')) inferredType = 'boolean'
            
            toolsSection += `| \`${key}\` | ${inferredType} |\n`
          }
        }
      }
      
      toolsSection += `\n`
    }
  }

  // Add usage instructions if available in block config
  let usageInstructions = ''
  if (longDescription) {
    usageInstructions = `## Usage Instructions\n\n${longDescription}\n\n`
  }

  // Generate the markdown content with fixed logic
  return `---
title: ${name}
description: ${description}
---

import { BlockInfoCard } from "@/components/ui/block-info-card"

<BlockInfoCard 
  type="${type}"
  color="${bgColor || '#F5F5F5'}"
  icon={${iconSvg ? 'true' : 'false'}}
  iconSvg={\`${iconSvg || ''}\`}
/>

${usageInstructions}

${toolsSection}

## Configuration

${subBlocks.length > 0 ? '### Input Parameters\n\n' + 
'| Parameter | Type | Required | Description | \n' +
'| --------- | ---- | -------- | ----------- | \n' +
inputsTable : 'No configuration parameters required.'}

${optionsSection}

## Outputs

${outputs && Object.keys(outputs).length > 0 ? outputsSection.replace('## Outputs\n\n', '') : 'This block does not produce any outputs.'}

## Notes

- Category: \`${category}\`
- Type: \`${type}\``
}

// Main function to generate all block docs
async function generateAllBlockDocs() {
  try {
    // Extract icons first
    const icons = extractIcons()
    
    // Get all block files
    const blockFiles = await glob(`${BLOCKS_PATH}/*.ts`)
    
    // Generate docs for each block
    for (const blockFile of blockFiles) {
      await generateBlockDoc(blockFile, icons)
    }
    
    // Update the meta.json file
    updateMetaJson()
    
    return true
  } catch (error) {
    console.error('Error generating documentation:', error)
    return false
  }
}

// Function to update the meta.json file with all blocks
function updateMetaJson() {
  const metaJsonPath = path.join(DOCS_OUTPUT_PATH, 'meta.json')
  
  // Get all MDX files in the tools directory
  const blockFiles = fs.readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))
    .map((file: string) => path.basename(file, '.mdx'))
  
  // Create meta.json structure
  // Keep "index" as the first item if it exists
  const items = [
    ...(blockFiles.includes('index') ? ['index'] : []),
    ...blockFiles.filter((file: string) => file !== 'index').sort()
  ]
  
  const metaJson = {
    items
  }
  
  // Write the meta.json file
  fs.writeFileSync(metaJsonPath, JSON.stringify(metaJson, null, 2))
}

// Run the script
generateAllBlockDocs().then((success) => {
  if (success) {
    console.log('Documentation generation completed successfully')
    process.exit(0)
  } else {
    console.error('Documentation generation failed')
    process.exit(1)
  }
}).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
}) 