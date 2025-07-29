#!/usr/bin/env ts-node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { glob } from 'glob'

console.log('Starting documentation generator...')

// Define directory paths
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// Paths configuration
const BLOCKS_PATH = path.join(rootDir, 'apps/sim/blocks/blocks')
const DOCS_OUTPUT_PATH = path.join(rootDir, 'apps/docs/content/docs/tools')
const ICONS_PATH = path.join(rootDir, 'apps/sim/components/icons.tsx')

// Make sure the output directory exists
if (!fs.existsSync(DOCS_OUTPUT_PATH)) {
  fs.mkdirSync(DOCS_OUTPUT_PATH, { recursive: true })
}

interface InputConfig {
  type: string
  required: boolean
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
    const functionDeclarationRegex =
      /export\s+function\s+(\w+Icon)\s*\([^)]*\)\s*{[\s\S]*?return\s*\(\s*<svg[\s\S]*?<\/svg>\s*\)/g
    const arrowFunctionRegex =
      /export\s+const\s+(\w+Icon)\s*=\s*\([^)]*\)\s*=>\s*(\(?\s*<svg[\s\S]*?<\/svg>\s*\)?)/g

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
    const _typeMatch = fileContent.match(/type\s+(\w+)Response\s*=/)
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
        access: toolsAccess,
      },
    }
  } catch (error) {
    console.error('Error extracting block configuration:', error)
    return null
  }
}

// Helper function to find the block type
function findBlockType(content: string, blockName: string): string {
  // Try to find the type within the main block export
  // Look for the pattern: export const [BlockName]Block: BlockConfig = { ... type: 'value' ... }
  const blockExportRegex = new RegExp(
    `export\\s+const\\s+${blockName}Block\\s*:[^{]*{[\\s\\S]*?type\\s*:\\s*['"]([^'"]+)['"][\\s\\S]*?}`,
    'i'
  )
  const blockExportMatch = content.match(blockExportRegex)
  if (blockExportMatch) return blockExportMatch[1]

  // Fallback: try to find type within a block config object that comes after the export
  const exportMatch = content.match(new RegExp(`export\\s+const\\s+${blockName}Block\\s*:`))
  if (exportMatch) {
    // Find the content after the export statement
    const afterExport = content.substring(exportMatch.index! + exportMatch[0].length)

    // Look for the first opening brace and then find type within that block
    const blockStartMatch = afterExport.match(/{/)
    if (blockStartMatch) {
      const blockStart = blockStartMatch.index!

      // Find the matching closing brace by counting braces
      let braceCount = 1
      let blockEnd = blockStart + 1

      while (blockEnd < afterExport.length && braceCount > 0) {
        if (afterExport[blockEnd] === '{') braceCount++
        else if (afterExport[blockEnd] === '}') braceCount--
        blockEnd++
      }

      // Extract the block content and look for type
      const blockContent = afterExport.substring(blockStart, blockEnd)
      const typeMatch = blockContent.match(/type\s*:\s*['"]([^'"]+)['"]/)
      if (typeMatch) return typeMatch[1]
    }
  }

  // Convert CamelCase to snake_case as fallback
  return blockName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
}

// Helper to extract a string property from content
function extractStringProperty(content: string, propName: string): string | null {
  // Try single quotes first - more permissive approach
  const singleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*'([^']*)'`, 'm'))
  if (singleQuoteMatch) return singleQuoteMatch[1]

  // Try double quotes
  const doubleQuoteMatch = content.match(new RegExp(`${propName}\\s*:\\s*"([^"]*)"`, 'm'))
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  // Try to match multi-line string with template literals
  const templateMatch = content.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 's'))
  if (templateMatch) {
    let templateContent = templateMatch[1]

    // Handle template literals with expressions by replacing them with reasonable defaults
    // This is a simple approach - we'll replace common variable references with sensible defaults
    templateContent = templateContent.replace(
      /\$\{[^}]*shouldEnableURLInput[^}]*\?[^:]*:[^}]*\}/g,
      'Upload files directly. '
    )
    templateContent = templateContent.replace(/\$\{[^}]*shouldEnableURLInput[^}]*\}/g, 'false')

    // Remove any remaining template expressions that we can't safely evaluate
    templateContent = templateContent.replace(/\$\{[^}]+\}/g, '')

    // Clean up any extra whitespace
    templateContent = templateContent.replace(/\s+/g, ' ').trim()

    return templateContent
  }

  return null
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

  blockMatches.forEach((blockText) => {
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
        options = optionMatches.map((optText) => {
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
      options: options.length > 0 ? options : undefined,
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
  const propMatches = inputsContent.match(/(\w+)\s*:\s*{[\s\S]*?}/g)
  if (!propMatches) {
    // Try an alternative approach for the whole inputs section
    const inputLines = inputsContent.split('\n')
    inputLines.forEach((line) => {
      const propMatch = line.match(/\s*(\w+)\s*:\s*{/)
      if (propMatch) {
        const propName = propMatch[1]
        const typeMatch = line.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = line.match(/required\s*:\s*(true|false)/)

        inputs[propName] = {
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
        }
      }
    })

    return inputs
  }

  propMatches.forEach((propText) => {
    const propMatch = propText.match(/(\w+)\s*:/)
    if (!propMatch) return

    const propName = propMatch[1]
    const typeMatch = propText.match(/type\s*:\s*['"]?([^'"}, ]+)['"]?/s)
    const requiredMatch = propText.match(/required\s*:\s*(true|false)/s)
    const _descriptionMatch = propText.match(/description\s*:\s*['"]([^'"]+)['"]/s)

    inputs[propName] = {
      type: typeMatch ? typeMatch[1] : 'any',
      required: requiredMatch ? requiredMatch[1] === 'true' : false,
    }
  })

  return inputs
}

// Updated function to extract outputs with a simpler and more reliable approach
function extractOutputs(content: string): Record<string, any> {
  // Look for the outputs section with a more resilient regex
  const outputsMatch = content.match(/outputs\s*:\s*{([^}]*)}(?:\s*,|\s*})/s)

  if (outputsMatch) {
    const outputsContent = outputsMatch[1].trim()
    const outputs: Record<string, any> = {}

    // First try to handle the new flat format: fieldName: 'type'
    const flatFieldMatches = outputsContent.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)

    if (flatFieldMatches && flatFieldMatches.length > 0) {
      flatFieldMatches.forEach((fieldMatch) => {
        const fieldParts = fieldMatch.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/)
        if (fieldParts) {
          const fieldName = fieldParts[1]
          const fieldType = fieldParts[2]

          outputs[fieldName] = {
            type: fieldType,
            description: `${fieldName} output from the block`,
          }
        }
      })

      // If we found flat fields, return them
      if (Object.keys(outputs).length > 0) {
        return outputs
      }
    }

    // Fallback: Try to extract fields from the old nested format
    const fieldMatches = outputsContent.match(/(\w+)\s*:\s*{([^}]+)}/g)

    if (fieldMatches && fieldMatches.length > 0) {
      fieldMatches.forEach((fieldMatch) => {
        const fieldNameMatch = fieldMatch.match(/(\w+)\s*:/)
        if (fieldNameMatch) {
          const fieldName = fieldNameMatch[1]

          // Check if there's a type with a nested structure
          const typeMatch = fieldMatch.match(/type\s*:\s*{([^}]+)}/)
          if (typeMatch) {
            // Handle nested type object
            const typeContent = typeMatch[1]
            const properties: Record<string, any> = {}

            // Extract property types from the type object - handle cases with comments
            // const propertyMatches = typeContent.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)
            const propertyMatches = typeContent.match(
              /(\w+)\s*:\s*['"]([^'"]+)['"](?:\s*,)?(?:\s*\/\/[^\n]*)?/g
            )
            if (propertyMatches) {
              propertyMatches.forEach((propMatch) => {
                // Extract the property name and type, ignoring any trailing comments
                const propParts = propMatch.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/)
                if (propParts) {
                  const propName = propParts[1]
                  const propType = propParts[2]

                  // Look for an inline comment that might contain a description
                  const commentMatch = propMatch.match(/\/\/\s*(.+)$/)
                  const description = commentMatch
                    ? commentMatch[1].trim()
                    : `${propName} of the ${fieldName}`

                  properties[propName] = {
                    type: propType,
                    description: description,
                  }
                }
              })
            }

            // Add the field with properties
            outputs[fieldName] = {
              properties,
              description: `${fieldName} from the block execution`,
            }
          } else {
            // Try to extract a simple type definition
            const simpleTypeMatch = fieldMatch.match(/type\s*:\s*['"]([^'"]+)['"]/)
            if (simpleTypeMatch) {
              outputs[fieldName] = {
                type: simpleTypeMatch[1],
                description: `${fieldName} output from the block`,
              }
            }
          }
        }
      })
    }

    // If we parsed anything, return it
    if (Object.keys(outputs).length > 0) {
      return outputs
    }
  }

  // Fallback to the original method for backward compatibility
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
        fieldMatches.forEach((match) => {
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
              type: typeFields,
            },
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
    toolMatches.forEach((toolText) => {
      const match = toolText.match(/['"]([^'"]+)['"]/)
      if (match) {
        tools.push(match[1])
      }
    })
  }

  return tools
}

// Function to extract tool information from file content
function extractToolInfo(
  toolName: string,
  fileContent: string,
  filePath = ''
): {
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
} | null {
  try {
    // Extract tool config section - Simplified regex to match any *Tool export pattern
    const toolConfigRegex = /export const \w+Tool\s*[=<][^{]*{[\s\S]*?params\s*:\s*{([\s\S]*?)}/im
    const toolConfigMatch = fileContent.match(toolConfigRegex)

    // Extract description
    const descriptionRegex = /description\s*:\s*['"]([^'"]+)['"].*/
    const descriptionMatch = fileContent.match(descriptionRegex)
    const description = descriptionMatch ? descriptionMatch[1] : 'No description available'

    // Parse parameters
    const params: Array<{ name: string; type: string; required: boolean; description: string }> = []

    if (toolConfigMatch) {
      const paramsContent = toolConfigMatch[1]

      // More robust approach to extract parameters
      // Extract each parameter block completely
      const paramBlocksRegex = /(\w+)\s*:\s*{([^}]+)}/g
      let paramMatch

      while ((paramMatch = paramBlocksRegex.exec(paramsContent)) !== null) {
        const paramName = paramMatch[1]
        const paramBlock = paramMatch[2]

        // Skip the accessToken parameter as it's handled automatically by the OAuth flow
        // Also skip any params parameter which isn't a real input
        if (paramName === 'accessToken' || paramName === 'params' || paramName === 'tools') {
          continue
        }

        // Extract param details with more robust patterns
        const typeMatch = paramBlock.match(/type\s*:\s*['"]([^'"]+)['"]/)
        const requiredMatch = paramBlock.match(/required\s*:\s*(true|false)/)

        // More careful extraction of description with handling for multiline descriptions
        let descriptionMatch = paramBlock.match(/description\s*:\s*'([^']*)'/)
        if (!descriptionMatch) {
          descriptionMatch = paramBlock.match(/description\s*:\s*"([^"]*)"/)
        }
        if (!descriptionMatch) {
          // Try for template literals if the description uses backticks
          descriptionMatch = paramBlock.match(/description\s*:\s*`([^`]+)`/)
        }

        params.push({
          name: paramName,
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
          description: descriptionMatch ? descriptionMatch[1] : 'No description',
        })
      }
    }

    // If no params were found with the first method, try a more direct regex approach
    if (params.length === 0) {
      const paramRegex =
        /(\w+)\s*:\s*{(?:[^{}]|{[^{}]*})*type\s*:\s*['"]([^'"]+)['"](?:[^{}]|{[^{}]*})*required\s*:\s*(true|false)(?:[^{}]|{[^{}]*})*description\s*:\s*['"]([^'"]+)['"](?:[^{}]|{[^{}]*})*}/g
      let match

      while ((match = paramRegex.exec(fileContent)) !== null) {
        // Skip the accessToken parameter and any params parameter
        if (match[1] === 'params' || match[1] === 'tools') continue

        params.push({
          name: match[1],
          type: match[2],
          required: match[3] === 'true',
          description: match[4] || 'No description',
        })
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
      const successOutputRegex =
        /success\s*:\s*true,\s*output\s*:\s*(\{[^}]*\}|\w+(\.\w+)+\s*\|\|\s*\{[^}]*\}|\w+(\.\w+)+\.map\s*\()/
      const successOutputMatch = fileContent.match(successOutputRegex)

      if (successOutputMatch) {
        const outputExpression = successOutputMatch[1].trim()

        // Handle case where output is something like "data.data || {}"
        if (outputExpression.includes('||')) {
          outputs.data = 'json'
        }
        // Handle array mapping like "data.issues.map(...)"
        else if (outputExpression.includes('.map')) {
          // Try to extract the array object being mapped
          const arrayMapMatch = outputExpression.match(/(\w+(?:\.\w+)+)\.map/)
          if (arrayMapMatch) {
            const arrayPath = arrayMapMatch[1]
            // Get the base object being mapped to an array
            const arrayObject = arrayPath.split('.').pop()
            if (arrayObject) {
              outputs[arrayObject] = 'Array of mapped items'
            }
          } else {
            // Fallback if we can't extract the exact array object
            outputs.items = 'Array of mapped items'
          }
        }
        // Handle direct object assignment like "output: { field1, field2 }"
        else if (outputExpression.startsWith('{')) {
          const fieldMatches = outputExpression.match(/(\w+)\s*:/g)
          if (fieldMatches) {
            fieldMatches.forEach((match) => {
              const fieldName = match.trim().replace(':', '')
              outputs[fieldName] = 'Dynamic output field'
            })
          }
        }
        // Check for data.X patterns like "data.data"
        else if (outputExpression.includes('.')) {
          const fieldName = outputExpression.split('.').pop()
          if (fieldName) {
            outputs[fieldName] = 'json'
          }
        }
      }
    }

    // Try to extract TypeScript interface for outputs as a fallback
    if (Object.keys(outputs).length === 0) {
      const interfaceRegex = new RegExp(
        `interface\\s+${toolName.replace(/_/g, '')}Response\\s*{[\\s\\S]*?output\\s*:\\s*{([\\s\\S]*?)}[\\s\\S]*?}`
      )
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
        const responseTypeRegex = new RegExp(
          `interface\\s+${toolName.replace(/_/g, '')}Response\\s*extends\\s+\\w+\\s*{\\s*output\\s*:\\s*{([\\s\\S]*?)}\\s*}`,
          'i'
        )
        const responseTypeMatch = typesContent.match(responseTypeRegex)

        if (responseTypeMatch) {
          outputs = parseOutputStructure(toolName, responseTypeMatch[1], typesContent)
        }
      }
    }

    return {
      description,
      params,
      outputs,
    }
  } catch (error) {
    console.error(`Error extracting info for tool ${toolName}:`, error)
    return null
  }
}

// Update the parseOutputStructure function to better handle nested objects
function parseOutputStructure(
  toolName: string,
  outputContent: string,
  fileContent: string
): Record<string, any> {
  const outputs: Record<string, any> = {}

  // Try to extract field declarations with their types
  const fieldRegex = /(\w+)\s*:([^,}]+)/g
  let fieldMatch

  while ((fieldMatch = fieldRegex.exec(outputContent)) !== null) {
    const fieldName = fieldMatch[1].trim()
    const _fieldType = fieldMatch[2].trim().replace(/["'[\]]/g, '')

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

  const shorthandRegex = /(?:^\s*|[,{]\s*)([A-Za-z_][\w]*)\s*(?=,|})/g
  let shorthandMatch

  while ((shorthandMatch = shorthandRegex.exec(outputContent)) !== null) {
    const fieldName = shorthandMatch[1].trim()

    // Ignore fields already captured or those that are part of key/value pairs
    if (outputs[fieldName]) continue

    // Provide the same heuristic descriptions as above
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
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
} | null> {
  try {
    // Split the tool name into parts
    const parts = toolName.split('_')

    // Try to find the correct split point by checking if directories exist
    let toolPrefix = ''
    let toolSuffix = ''

    // Start from the longest possible prefix and work backwards
    for (let i = parts.length - 1; i >= 1; i--) {
      const possiblePrefix = parts.slice(0, i).join('_')
      const possibleSuffix = parts.slice(i).join('_')

      // Check if a directory exists for this prefix
      const toolDirPath = path.join(rootDir, `apps/sim/tools/${possiblePrefix}`)

      if (fs.existsSync(toolDirPath) && fs.statSync(toolDirPath).isDirectory()) {
        toolPrefix = possiblePrefix
        toolSuffix = possibleSuffix
        break
      }
    }

    // If no directory was found, fall back to single-part prefix
    if (!toolPrefix) {
      toolPrefix = parts[0]
      toolSuffix = parts.slice(1).join('_')
    }

    // Simplify the file search strategy
    const possibleLocations = []

    // Most common pattern: suffix.ts file in the prefix directory
    possibleLocations.push(path.join(rootDir, `apps/sim/tools/${toolPrefix}/${toolSuffix}.ts`))

    // Try underscore version if suffix has multiple parts
    if (toolSuffix.includes('_')) {
      const underscoreSuffix = toolSuffix.replace(/_/g, '_')
      possibleLocations.push(
        path.join(rootDir, `apps/sim/tools/${toolPrefix}/${underscoreSuffix}.ts`)
      )
    }

    // Try camelCase version of suffix
    const camelCaseSuffix = toolSuffix
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('')
    possibleLocations.push(path.join(rootDir, `apps/sim/tools/${toolPrefix}/${camelCaseSuffix}.ts`))

    // Also check the index.ts file in the tool directory
    possibleLocations.push(path.join(rootDir, `apps/sim/tools/${toolPrefix}/index.ts`))

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

    // If not found, search in tool-specific directory
    if (!toolFileContent) {
      const toolsDir = path.join(rootDir, 'apps/tools')
      if (fs.existsSync(path.join(toolsDir, toolPrefix))) {
        const dirPath = path.join(toolsDir, toolPrefix)
        const files = fs.readdirSync(dirPath).filter((file) => file.endsWith('.ts'))

        for (const file of files) {
          const filePath = path.join(dirPath, file)
          const content = fs.readFileSync(filePath, 'utf-8')

          // Check if this file contains the tool id
          if (content.includes(`id: '${toolName}'`) || content.includes(`id: "${toolName}"`)) {
            toolFilePath = filePath
            toolFileContent = content
            break
          }
        }
      }
    }

    if (!toolFileContent) {
      console.warn(`Could not find definition for tool: ${toolName}`)
      return null
    }

    // Extract tool information from the file
    return extractToolInfo(toolName, toolFileContent, toolFilePath)
  } catch (error) {
    console.error(`Error getting info for tool ${toolName}:`, error)
    return null
  }
}

// Function to extract content between manual content markers
function extractManualContent(existingContent: string): Record<string, string> {
  const manualSections: Record<string, string> = {}
  // Improved regex to better handle MDX comments
  const manualContentRegex =
    /\{\/\*\s*MANUAL-CONTENT-START:(\w+)\s*\*\/\}([\s\S]*?)\{\/\*\s*MANUAL-CONTENT-END\s*\*\/\}/g

  let match
  while ((match = manualContentRegex.exec(existingContent)) !== null) {
    const sectionName = match[1]
    const content = match[2].trim()
    manualSections[sectionName] = content
    console.log(`Found manual content for section: ${sectionName}`)
  }

  return manualSections
}

// Function to merge generated markdown with manual content
function mergeWithManualContent(
  generatedMarkdown: string,
  existingContent: string | null,
  manualSections: Record<string, string>
): string {
  if (!existingContent || Object.keys(manualSections).length === 0) {
    return generatedMarkdown
  }

  console.log('Merging manual content with generated markdown')

  // Log what we found for debugging
  console.log(`Found ${Object.keys(manualSections).length} manual sections`)
  Object.keys(manualSections).forEach((section) => {
    console.log(`  - ${section}: ${manualSections[section].substring(0, 20)}...`)
  })

  // Replace placeholders in generated markdown with manual content
  let mergedContent = generatedMarkdown

  // Add manual content for each section we found
  Object.entries(manualSections).forEach(([sectionName, content]) => {
    // Define insertion points for different section types with improved patterns
    const insertionPoints: Record<string, { regex: RegExp }> = {
      intro: {
        regex: /<BlockInfoCard[\s\S]*?<\/svg>`}\s*\/>/,
      },
      usage: {
        regex: /## Usage Instructions/,
      },
      configuration: {
        regex: /## Configuration/,
      },
      outputs: {
        regex: /## Outputs/,
      },
      notes: {
        regex: /## Notes/,
      },
    }

    // Find the appropriate insertion point
    const insertionPoint = insertionPoints[sectionName]

    if (insertionPoint) {
      // Use regex to find the insertion point
      const match = mergedContent.match(insertionPoint.regex)

      if (match && match.index !== undefined) {
        // Insert after the matched content
        const insertPosition = match.index + match[0].length
        console.log(`Inserting ${sectionName} content after position ${insertPosition}`)
        mergedContent = `${mergedContent.slice(0, insertPosition)}\n\n{/* MANUAL-CONTENT-START:${sectionName} */}\n${content}\n{/* MANUAL-CONTENT-END */}\n${mergedContent.slice(insertPosition)}`
      } else {
        console.log(
          `Could not find insertion point for ${sectionName}, regex pattern: ${insertionPoint.regex}`
        )
      }
    } else {
      console.log(`No insertion point defined for section ${sectionName}`)
    }
  })

  return mergedContent
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

    // Skip blocks with category 'blocks' (except memory type), and skip specific blocks
    if (
      (blockConfig.category === 'blocks' &&
        blockConfig.type !== 'memory' &&
        blockConfig.type !== 'knowledge') ||
      blockConfig.type === 'evaluator' ||
      blockConfig.type === 'number'
    ) {
      return
    }

    // Output file path
    const outputFilePath = path.join(DOCS_OUTPUT_PATH, `${blockConfig.type}.mdx`)

    // IMPORTANT: Check if file already exists and read its content FIRST
    let existingContent: string | null = null
    if (fs.existsSync(outputFilePath)) {
      existingContent = fs.readFileSync(outputFilePath, 'utf-8')
      console.log(`Existing file found for ${blockConfig.type}.mdx, checking for manual content...`)
    }

    // Extract manual content from existing file before generating new content
    const manualSections = existingContent ? extractManualContent(existingContent) : {}

    // Create the markdown content - now async
    const markdown = await generateMarkdownForBlock(blockConfig, icons)

    // Merge with manual content if we found any
    let finalContent = markdown
    if (Object.keys(manualSections).length > 0) {
      console.log(`Found manual content in ${blockConfig.type}.mdx, merging...`)
      finalContent = mergeWithManualContent(markdown, existingContent, manualSections)
    } else {
      console.log(`No manual content found in ${blockConfig.type}.mdx`)
    }

    // Write the markdown file
    fs.writeFileSync(outputFilePath, finalContent)
    console.log(`Generated documentation for ${blockConfig.type}`)
  } catch (error) {
    console.error(`Error processing ${blockPath}:`, error)
  }
}

// Update generateMarkdownForBlock to remove placeholders
async function generateMarkdownForBlock(
  blockConfig: BlockConfig,
  icons: Record<string, string>
): Promise<string> {
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
    tools = { access: [], config: {} },
  } = blockConfig

  // Get SVG icon if available
  const iconSvg = iconName && icons[iconName] ? icons[iconName] : null

  // Create inputs table content with better descriptions
  let inputsTable = ''

  if (Object.keys(inputs).length > 0) {
    inputsTable = Object.entries(inputs)
      .map(([key, config]) => {
        const inputConfig = config as InputConfig
        const subBlock = subBlocks.find((sb) => sb.id === key)

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
                .filter((opt) => typeof opt === 'string')
                .map((opt) => `\`${opt}\``)
                .join(', ')
            } else {
              // Object array options with id/label
              optionsList = subBlock.options
                .filter((opt) => typeof opt === 'object' && opt !== null && 'id' in opt)
                .map((opt) => {
                  const option = opt as any
                  return `\`${option.id}\` (${option.label || option.id})`
                })
                .join(', ')
            }
          }
          description += optionsList ? `: ${optionsList}` : ''
        }

        // Escape special characters in descriptions
        const escapedDescription = description
          .replace(/\|/g, '\\|') // Escape pipe characters
          .replace(/\{/g, '\\{') // Escape curly braces
          .replace(/\}/g, '\\}') // Escape curly braces
          .replace(/\(/g, '\\(') // Escape opening parentheses
          .replace(/\)/g, '\\)') // Escape closing parentheses
          .replace(/\[/g, '\\[') // Escape opening brackets
          .replace(/\]/g, '\\]') // Escape closing brackets
          .replace(/</g, '&lt;') // Convert less than to HTML entity
          .replace(/>/g, '&gt;') // Convert greater than to HTML entity

        return `| \`${key}\` | ${inputConfig.type || 'string'} | ${inputConfig.required ? 'Yes' : 'No'} | ${escapedDescription} |`
      })
      .join('\n')
  } else if (subBlocks.length > 0) {
    // If we have subBlocks but no inputs mapping, try to create the table from subBlocks
    inputsTable = subBlocks
      .map((subBlock) => {
        const id = subBlock.id || ''
        const title = subBlock.title || ''
        const type = subBlock.type || 'string'
        const required = subBlock.condition ? 'No' : 'Yes'

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
                .filter((opt) => typeof opt === 'string')
                .map((opt) => `\`${opt}\``)
                .join(', ')
            } else {
              // Object array options with id/label
              optionsList = subBlock.options
                .filter((opt) => typeof opt === 'object' && opt !== null && 'id' in opt)
                .map((opt) => {
                  const option = opt as any
                  return `\`${option.id}\` (${option.label || option.id})`
                })
                .join(', ')
            }
          }
          description += optionsList ? `: ${optionsList}` : ''
        }

        // Escape special characters in descriptions
        const escapedDescription = description
          .replace(/\|/g, '\\|') // Escape pipe characters
          .replace(/\{/g, '\\{') // Escape curly braces
          .replace(/\}/g, '\\}') // Escape curly braces
          .replace(/\(/g, '\\(') // Escape opening parentheses
          .replace(/\)/g, '\\)') // Escape closing parentheses
          .replace(/\[/g, '\\[') // Escape opening brackets
          .replace(/\]/g, '\\]') // Escape closing brackets
          .replace(/</g, '&lt;') // Convert less than to HTML entity
          .replace(/>/g, '&gt;') // Convert greater than to HTML entity

        return `| \`${id}\` | ${type} | ${required} | ${escapedDescription} |`
      })
      .join('\n')
  }

  // Create detailed options section for dropdowns
  const dropdownBlocks = subBlocks.filter(
    (sb) =>
      (sb.type === 'dropdown' || sb.options) && Array.isArray(sb.options) && sb.options.length > 0
  )

  let optionsSection = ''
  if (dropdownBlocks.length > 0) {
    optionsSection = '## Available Options\n\n'

    dropdownBlocks.forEach((sb) => {
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

  // Generate the outputs section
  let outputsSection = ''

  if (outputs && Object.keys(outputs).length > 0) {
    outputsSection = '## Outputs\n\n'

    // Create the base outputs table
    outputsSection += '| Output | Type | Description |\n'
    outputsSection += '| ------ | ---- | ----------- |\n'

    // Process each output field
    for (const outputKey in outputs) {
      const output = outputs[outputKey]

      // Escape special characters in the description that could break markdown tables
      const escapedDescription = output.description
        ? output.description
            .replace(/\|/g, '\\|') // Escape pipe characters
            .replace(/\{/g, '\\{') // Escape curly braces
            .replace(/\}/g, '\\}') // Escape curly braces
            .replace(/\(/g, '\\(') // Escape opening parentheses
            .replace(/\)/g, '\\)') // Escape closing parentheses
            .replace(/\[/g, '\\[') // Escape opening brackets
            .replace(/\]/g, '\\]') // Escape closing brackets
            .replace(/</g, '&lt;') // Convert less than to HTML entity
            .replace(/>/g, '&gt;') // Convert greater than to HTML entity
        : `Output from ${outputKey}`

      if (typeof output.type === 'string') {
        // Simple output with explicit type
        outputsSection += `| \`${outputKey}\` | ${output.type} | ${escapedDescription} |\n`
      } else if (output.type && typeof output.type === 'object') {
        // For cases where output.type is an object containing field types
        outputsSection += `| \`${outputKey}\` | object | ${escapedDescription} |\n`

        // Add properties directly to the main table with indentation
        for (const propName in output.type) {
          const propType = output.type[propName]
          // Get description from comments if available
          const commentMatch =
            propName && output.type[propName]._comment
              ? output.type[propName]._comment
              : `${propName} of the ${outputKey}`

          outputsSection += `| ↳ \`${propName}\` | ${propType} | ${commentMatch} |\n`
        }
      } else if (output.properties) {
        // Complex output with properties
        outputsSection += `| \`${outputKey}\` | object | ${escapedDescription} |\n`

        // Add properties directly to the main table with indentation
        for (const propName in output.properties) {
          const prop = output.properties[propName]
          // Escape special characters in the description
          const escapedPropertyDescription = prop.description
            ? prop.description
                .replace(/\|/g, '\\|') // Escape pipe characters
                .replace(/\{/g, '\\{') // Escape curly braces
                .replace(/\}/g, '\\}') // Escape curly braces
                .replace(/\(/g, '\\(') // Escape opening parentheses
                .replace(/\)/g, '\\)') // Escape closing parentheses
                .replace(/\[/g, '\\[') // Escape opening brackets
                .replace(/\]/g, '\\]') // Escape closing brackets
                .replace(/</g, '&lt;') // Convert less than to HTML entity
                .replace(/>/g, '&gt;') // Convert greater than to HTML entity
            : `The ${propName} of the ${outputKey}`

          outputsSection += `| ↳ \`${propName}\` | ${prop.type} | ${escapedPropertyDescription} |\n`
        }
      }
    }
  } else {
    outputsSection = 'This block does not produce any outputs.'
  }

  // Create tools section with more details
  let toolsSection = ''
  if (tools.access?.length) {
    toolsSection = '## Tools\n\n'

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
        toolsSection += '#### Input\n\n'
        toolsSection += '| Parameter | Type | Required | Description |\n'
        toolsSection += '| --------- | ---- | -------- | ----------- |\n'

        if (toolInfo.params.length > 0) {
          // Use dynamically extracted parameters
          for (const param of toolInfo.params) {
            // Escape special characters in the description that could break markdown tables
            const escapedDescription = param.description
              ? param.description
                  .replace(/\|/g, '\\|') // Escape pipe characters
                  .replace(/\{/g, '\\{') // Escape curly braces
                  .replace(/\}/g, '\\}') // Escape curly braces
                  .replace(/\(/g, '\\(') // Escape opening parentheses
                  .replace(/\)/g, '\\)') // Escape closing parentheses
                  .replace(/\[/g, '\\[') // Escape opening brackets
                  .replace(/\]/g, '\\]') // Escape closing brackets
                  .replace(/</g, '&lt;') // Convert less than to HTML entity
                  .replace(/>/g, '&gt;') // Convert greater than to HTML entity
              : 'No description'

            toolsSection += `| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${escapedDescription} |\n`
          }
        }

        // Add Output Parameters section for the tool
        toolsSection += '\n#### Output\n\n'

        if (Object.keys(toolInfo.outputs).length > 0) {
          // Use dynamically extracted outputs in table format
          toolsSection += generateMarkdownTable(toolInfo.outputs)
        } else {
          toolsSection += 'This tool does not produce any outputs.\n'
        }
      }

      toolsSection += '\n'
    }
  }

  // Add usage instructions if available in block config
  let usageInstructions = ''
  if (longDescription) {
    usageInstructions = `## Usage Instructions\n\n${longDescription}\n\n`
  }

  // Generate the markdown content without any placeholders
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

## Block Configuration

${
  subBlocks.length > 0
    ? `### Input\n\n| Parameter | Type | Required | Description | \n| --------- | ---- | -------- | ----------- | \n${inputsTable}`
    : 'No configuration parameters required.'
}

${optionsSection}

### Outputs

${outputs && Object.keys(outputs).length > 0 ? outputsSection.replace('## Outputs\n\n', '') : 'This block does not produce any outputs.'}

## Notes

- Category: \`${category}\`
- Type: \`${type}\`
`
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
  const blockFiles = fs
    .readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))
    .map((file: string) => path.basename(file, '.mdx'))

  // Create meta.json structure
  // Keep "index" as the first item if it exists
  const items = [
    ...(blockFiles.includes('index') ? ['index'] : []),
    ...blockFiles.filter((file: string) => file !== 'index').sort(),
  ]

  const metaJson = {
    items,
  }

  // Write the meta.json file
  fs.writeFileSync(metaJsonPath, JSON.stringify(metaJson, null, 2))
}

// Run the script
generateAllBlockDocs()
  .then((success) => {
    if (success) {
      console.log('Documentation generation completed successfully')
      process.exit(0)
    } else {
      console.error('Documentation generation failed')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

function generateMarkdownTable(outputs: Record<string, string>): string {
  let table = ''
  table += '| Parameter | Type |\n'
  table += '| --------- | ---- |\n'

  for (const [key, value] of Object.entries(outputs)) {
    // Try to determine a reasonable type from the value description
    let inferredType = 'string'
    if (value.toLowerCase().includes('array')) inferredType = 'array'
    if (value.toLowerCase().includes('json')) inferredType = 'json'
    if (value.toLowerCase().includes('number')) inferredType = 'number'
    if (value.toLowerCase().includes('boolean')) inferredType = 'boolean'

    table += `| \`${key}\` | ${inferredType} |\n`
  }

  return table
}
