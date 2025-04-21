#!/usr/bin/env node
// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

console.log("Starting documentation generator...");

// Define directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log(`Scripts directory: ${__dirname}`);
console.log(`Root directory: ${rootDir}`);

// Paths configuration
const BLOCKS_PATH = path.join(rootDir, 'sim/blocks/blocks');
const DOCS_OUTPUT_PATH = path.join(rootDir, 'docs/content/docs/tools');
const ICONS_PATH = path.join(rootDir, 'sim/components/icons.tsx');

console.log(`Blocks path: ${BLOCKS_PATH}`);
console.log(`Output path: ${DOCS_OUTPUT_PATH}`);
console.log(`Icons path: ${ICONS_PATH}`);

// Make sure the output directory exists
if (!fs.existsSync(DOCS_OUTPUT_PATH)) {
  console.log(`Creating output directory: ${DOCS_OUTPUT_PATH}`);
  fs.mkdirSync(DOCS_OUTPUT_PATH, { recursive: true });
}

// Type for block input config
interface InputConfig {
  type: string;
  required: boolean;
}

// Type for block output config
interface OutputConfig {
  type: string | Record<string, any>;
}

// Basic interface for BlockConfig to avoid import issues
interface BlockConfig {
  type: string;
  name: string;
  description: string;
  longDescription?: string;
  category: string;
  bgColor?: string;
  icon?: any;
  subBlocks?: Array<{
    id: string;
    title?: string;
    placeholder?: string;
    type?: string;
    layout?: string;
    options?: Array<{ label: string; id: string }>;
    [key: string]: any;
  }>;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  tools?: {
    access?: string[];
    config?: any;
  };
  [key: string]: any;
}

// Function to extract SVG icons from icons.tsx file
function extractIcons(): Record<string, string> {
  try {
    const iconsContent = fs.readFileSync(ICONS_PATH, 'utf-8');
    const icons: Record<string, string> = {};
    
    // Match both function declaration and arrow function export patterns
    const functionDeclarationRegex = /export\s+function\s+(\w+Icon)\s*\([^)]*\)\s*{[\s\S]*?return\s*\(\s*<svg[\s\S]*?<\/svg>\s*\)/g;
    const arrowFunctionRegex = /export\s+const\s+(\w+Icon)\s*=\s*\([^)]*\)\s*=>\s*(\(?\s*<svg[\s\S]*?<\/svg>\s*\)?)/g;
    
    // Extract function declaration style icons
    const functionMatches = Array.from(iconsContent.matchAll(functionDeclarationRegex));
    for (const match of functionMatches) {
      const iconName = match[1];
      const svgMatch = match[0].match(/<svg[\s\S]*?<\/svg>/);
      
      if (iconName && svgMatch) {
        // Clean the SVG to remove {...props} and standardize size
        let svgContent = svgMatch[0];
        svgContent = svgContent.replace(/{\.\.\.props}/g, '');
        svgContent = svgContent.replace(/{\.\.\.(props|rest)}/g, '');
        // Remove any existing width/height attributes to let CSS handle sizing
        svgContent = svgContent.replace(/width=["'][^"']*["']/g, '');
        svgContent = svgContent.replace(/height=["'][^"']*["']/g, '');
        // Add className for styling
        svgContent = svgContent.replace(/<svg/, '<svg className="block-icon"');
        icons[iconName] = svgContent;
      }
    }
    
    // Extract arrow function style icons
    const arrowMatches = Array.from(iconsContent.matchAll(arrowFunctionRegex));
    for (const match of arrowMatches) {
      const iconName = match[1];
      const svgContent = match[2];
      const svgMatch = svgContent.match(/<svg[\s\S]*?<\/svg>/);
      
      if (iconName && svgMatch) {
        // Clean the SVG to remove {...props} and standardize size
        let cleanedSvg = svgMatch[0];
        cleanedSvg = cleanedSvg.replace(/{\.\.\.props}/g, '');
        cleanedSvg = cleanedSvg.replace(/{\.\.\.(props|rest)}/g, '');
        // Remove any existing width/height attributes to let CSS handle sizing
        cleanedSvg = cleanedSvg.replace(/width=["'][^"']*["']/g, '');
        cleanedSvg = cleanedSvg.replace(/height=["'][^"']*["']/g, '');
        // Add className for styling
        cleanedSvg = cleanedSvg.replace(/<svg/, '<svg className="block-icon"');
        icons[iconName] = cleanedSvg;
      }
    }
    
    console.log(`Extracted ${Object.keys(icons).length} icons from icons.tsx`);
    return icons;
  } catch (error) {
    console.error('Error extracting icons:', error);
    return {};
  }
}

// Function to extract block configuration from file content
function extractBlockConfig(fileContent: string): BlockConfig | null {
  try {
    // Match the block name and type from imports and export statement
    const typeMatch = fileContent.match(/type\s+(\w+)Response\s*=/);
    const exportMatch = fileContent.match(/export\s+const\s+(\w+)Block\s*:/);
    
    if (!exportMatch) {
      console.warn('No block export found in file');
      return null;
    }

    const blockName = exportMatch[1];
    const blockType = findBlockType(fileContent, blockName);
    
    // Extract individual properties with more robust regex
    const name = extractStringProperty(fileContent, 'name') || `${blockName} Block`;
    const description = extractStringProperty(fileContent, 'description') || '';
    const longDescription = extractStringProperty(fileContent, 'longDescription') || '';
    const category = extractStringProperty(fileContent, 'category') || 'misc';
    const bgColor = extractStringProperty(fileContent, 'bgColor') || '#F5F5F5';
    const iconName = extractIconName(fileContent) || '';
    
    // Extract subBlocks array
    const subBlocks = extractSubBlocks(fileContent);
    
    // Extract inputs object
    const inputs = extractInputs(fileContent);
    
    // Extract outputs object with better handling
    const outputs = extractOutputs(fileContent);
    
    // Extract tools access array
    const toolsAccess = extractToolsAccess(fileContent);
    
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
    };
  } catch (error) {
    console.error('Error extracting block configuration:', error);
    return null;
  }
}

// Helper function to find the block type
function findBlockType(content: string, blockName: string): string {
  // Try to find explicitly defined type
  const typeMatch = content.match(/type\s*:\s*['"]([^'"]+)['"]/);
  if (typeMatch) return typeMatch[1];
  
  // Convert CamelCase to snake_case as fallback
  return blockName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

// Helper to extract a string property from content
function extractStringProperty(content: string, propName: string): string | null {
  const simpleMatch = content.match(new RegExp(`${propName}\\s*:\\s*['"]([^'"]+)['"]`, 'm'));
  if (simpleMatch) return simpleMatch[1];
  
  // Try to match multi-line string with template literals
  const templateMatch = content.match(new RegExp(`${propName}\\s*:\\s*\`([^\`]+)\``, 'm'));
  return templateMatch ? templateMatch[1] : null;
}

// Helper to extract icon name from content
function extractIconName(content: string): string | null {
  const iconMatch = content.match(/icon\s*:\s*(\w+Icon)/);
  return iconMatch ? iconMatch[1] : null;
}

// Helper to extract subBlocks array
function extractSubBlocks(content: string): any[] {
  const subBlocksMatch = content.match(/subBlocks\s*:\s*\[([\s\S]*?)\s*\],/);
  if (!subBlocksMatch) return [];
  
  const subBlocksContent = subBlocksMatch[1];
  const blocks: any[] = [];
  
  // Find all block objects
  const blockMatches = subBlocksContent.match(/{\s*id\s*:[^}]*}/g);
  if (!blockMatches) return [];
  
  blockMatches.forEach(blockText => {
    const id = extractStringProperty(blockText, 'id');
    const title = extractStringProperty(blockText, 'title');
    const placeholder = extractStringProperty(blockText, 'placeholder');
    const type = extractStringProperty(blockText, 'type');
    const layout = extractStringProperty(blockText, 'layout');
    
    // Extract options array if present
    const optionsMatch = blockText.match(/options\s*:\s*\[([\s\S]*?)\]/);
    let options: Array<{ label: string | null; id: string | null }> = [];
    
    if (optionsMatch) {
      const optionsText = optionsMatch[1];
      const optionMatches = optionsText.match(/{\s*label\s*:[^}]*}/g);
      
      if (optionMatches) {
        options = optionMatches.map(optText => {
          const label = extractStringProperty(optText, 'label');
          const optId = extractStringProperty(optText, 'id');
          return { label, id: optId };
        });
      }
    }
    
    blocks.push({
      id,
      title,
      placeholder,
      type,
      layout,
      options: options.length > 0 ? options : undefined
    });
  });
  
  return blocks;
}

// Function to extract inputs object
function extractInputs(content: string): Record<string, any> {
  const inputsMatch = content.match(/inputs\s*:\s*{([\s\S]*?)},/);
  if (!inputsMatch) return {};
  
  const inputsContent = inputsMatch[1];
  const inputs: Record<string, any> = {};
  
  // Find all input property definitions
  const propMatches = inputsContent.match(/(\w+)\s*:\s*{[^}]*}/g);
  if (!propMatches) {
    // Try an alternative approach for the whole inputs section
    const inputLines = inputsContent.split('\n');
    inputLines.forEach(line => {
      const propMatch = line.match(/\s*(\w+)\s*:\s*{/);
      if (propMatch) {
        const propName = propMatch[1];
        const typeMatch = line.match(/type\s*:\s*['"]([^'"]+)['"]/);
        const requiredMatch = line.match(/required\s*:\s*(true|false)/);
        
        inputs[propName] = {
          type: typeMatch ? typeMatch[1] : 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false
        };
      }
    });
    
    return inputs;
  }
  
  propMatches.forEach(propText => {
    const propMatch = propText.match(/(\w+)\s*:/);
    if (!propMatch) return;
    
    const propName = propMatch[1];
    const typeMatch = propText.match(/type\s*:\s*['"]?([^'"}, ]+)['"]?/);
    const requiredMatch = propText.match(/required\s*:\s*(true|false)/);
    
    inputs[propName] = {
      type: typeMatch ? typeMatch[1] : 'any',
      required: requiredMatch ? requiredMatch[1] === 'true' : false
    };
  });
  
  return inputs;
}

// Helper to extract outputs object
function extractOutputs(content: string): Record<string, any> {
  const outputsMatch = content.match(/outputs\s*:\s*{([\s\S]*?)},/);
  if (!outputsMatch) return {};
  
  const outputsContent = outputsMatch[1];
  const outputs: Record<string, any> = {};
  
  // Try more patterns to match outputs
  // First try with response field specifically
  const responseMatch = outputsContent.match(/response\s*:\s*{([\s\S]*?)}/);
  if (responseMatch) {
    const responseContent = responseMatch[1];
    const typeMatch = responseContent.match(/type\s*:\s*{([\s\S]*?)}/);
    
    if (typeMatch) {
      const typeContent = typeMatch[1];
      const typeFields: Record<string, string> = {};
      
      // Extract field types with different patterns
      const fieldLines = typeContent.split('\n');
      fieldLines.forEach(line => {
        const simpleFieldMatch = line.match(/\s*(\w+)\s*:\s*['"]([^'"]+)['"]/);
        if (simpleFieldMatch) {
          typeFields[simpleFieldMatch[1]] = simpleFieldMatch[2];
        }
      });
      
      outputs.response = { type: typeFields };
    }
  }
  
  // If no outputs found with the specific approach, try the general approach
  if (Object.keys(outputs).length === 0) {
    // Find all output property definitions
    const propMatches = outputsContent.match(/(\w+)\s*:\s*{([\s\S]*?)},/g);
    if (propMatches) {
      propMatches.forEach(propText => {
        const propMatch = propText.match(/(\w+)\s*:/);
        if (!propMatch) return;
        
        const propName = propMatch[1];
        
        // Check for nested type object
        const typeObjectMatch = propText.match(/type\s*:\s*{([\s\S]*?)}/);
        
        if (typeObjectMatch) {
          // Extract nested type properties
          const typeContent = typeObjectMatch[1];
          const typeProps: Record<string, string> = {};
          
          const typePropMatches = typeContent.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/g);
          if (typePropMatches) {
            typePropMatches.forEach(typePropText => {
              const match = typePropText.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/);
              if (match) {
                typeProps[match[1]] = match[2];
              }
            });
          }
          
          outputs[propName] = { type: typeProps };
        } else {
          // Simple type string
          const typeMatch = propText.match(/type\s*:\s*['"]([^'"]+)['"]/);
          outputs[propName] = {
            type: typeMatch ? typeMatch[1] : 'any'
          };
        }
      });
    }
  }
  
  // If still no outputs, try a last resort approach
  if (Object.keys(outputs).length === 0) {
    // Look for type: { ... } sections directly
    const typeObjectMatches = outputsContent.match(/type\s*:\s*{([\s\S]*?)}/g);
    if (typeObjectMatches && typeObjectMatches.length > 0) {
      const typeContent = typeObjectMatches[0].match(/type\s*:\s*{([\s\S]*?)}/)?.[1] || '';
      const typeProps: Record<string, string> = {};
      
      const fieldMatches = typeContent.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/g);
      if (fieldMatches) {
        fieldMatches.forEach(fieldText => {
          const match = fieldText.match(/(\w+)\s*:\s*['"]([^'"]+)['"]/);
          if (match) {
            typeProps[match[1]] = match[2];
          }
        });
      }
      
      if (Object.keys(typeProps).length > 0) {
        outputs.response = { type: typeProps };
      }
    }
  }
  
  return outputs;
}

// Helper to extract tools access array
function extractToolsAccess(content: string): string[] {
  const accessMatch = content.match(/access\s*:\s*\[\s*((?:['"][^'"]+['"](?:\s*,\s*)?)+)\s*\]/);
  if (!accessMatch) return [];
  
  const accessContent = accessMatch[1];
  const tools: string[] = [];
  
  const toolMatches = accessContent.match(/['"]([^'"]+)['"]/g);
  if (toolMatches) {
    toolMatches.forEach(toolText => {
      const match = toolText.match(/['"]([^'"]+)['"]/);
      if (match) {
        tools.push(match[1]);
      }
    });
  }
  
  return tools;
}

// Function to generate documentation for a block
async function generateBlockDoc(blockPath: string, icons: Record<string, string>) {
  try {
    // Extract the block name from the file path
    const blockFileName = path.basename(blockPath, '.ts');
    if (blockFileName.endsWith('.test')) {
      console.log(`Skipping test file: ${blockFileName}`);
      return; // Skip test files
    }
    
    console.log(`Processing block file: ${blockPath}`);
    
    // Read the file content
    const fileContent = fs.readFileSync(blockPath, 'utf-8');
    
    // Extract block configuration from the file content
    const blockConfig = extractBlockConfig(fileContent);
    
    if (!blockConfig || !blockConfig.type) {
      console.warn(`Skipping ${blockFileName} - not a valid block config`);
      return;
    }
    
    console.log(`Generating docs for ${blockConfig.name} (${blockConfig.type})`);
    
    // Create the markdown content
    const markdown = generateMarkdownForBlock(blockConfig, icons);
    
    // Write the markdown file
    const outputFilePath = path.join(DOCS_OUTPUT_PATH, `${blockConfig.type}.mdx`);
    fs.writeFileSync(outputFilePath, markdown);
    
    console.log(`Created ${outputFilePath}`);
  } catch (error) {
    console.error(`Error processing ${blockPath}:`, error);
  }
}

// Function to generate markdown for a block
function generateMarkdownForBlock(blockConfig: BlockConfig, icons: Record<string, string>): string {
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
  } = blockConfig;

  // Get SVG icon if available
  const iconSvg = iconName && icons[iconName] ? icons[iconName] : null;

  // Create inputs table content with better descriptions
  let inputsTable = '';
  
  if (Object.keys(inputs).length > 0) {
    inputsTable = Object.entries(inputs).map(([key, config]) => {
      const inputConfig = config as InputConfig;
      const subBlock = subBlocks.find(sb => sb.id === key);
      
      let description = subBlock?.title || '';
      if (subBlock?.placeholder) {
        description += description ? ` - ${subBlock.placeholder}` : subBlock.placeholder;
      }
      
      if (subBlock?.options) {
        let optionsList = '';
        if (Array.isArray(subBlock.options) && subBlock.options.length > 0) {
          if (typeof subBlock.options[0] === 'string') {
            // String array options
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'string')
              .map(opt => `\`${opt}\``)
              .join(', ');
          } else {
            // Object array options with id/label
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'object' && opt !== null && 'id' in opt)
              .map(opt => {
                const option = opt as any;
                return `\`${option.id}\` (${option.label || option.id})`;
              })
              .join(', ');
          }
        }
        description += optionsList ? `: ${optionsList}` : '';
      }
      
      return `| \`${key}\` | ${inputConfig.type || 'string'} | ${inputConfig.required ? 'Yes' : 'No'} | ${description} |`;
    }).join('\n');
  } else if (subBlocks.length > 0) {
    // If we have subBlocks but no inputs mapping, try to create the table from subBlocks
    inputsTable = subBlocks.map(subBlock => {
      const id = subBlock.id || '';
      const title = subBlock.title || '';
      const type = subBlock.type || 'string';
      const required = !!subBlock.condition ? 'No' : 'Yes';
      
      let description = title;
      if (subBlock.placeholder) {
        description += title ? ` - ${subBlock.placeholder}` : subBlock.placeholder;
      }
      
      if (subBlock.options) {
        let optionsList = '';
        if (Array.isArray(subBlock.options) && subBlock.options.length > 0) {
          if (typeof subBlock.options[0] === 'string') {
            // String array options
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'string')
              .map(opt => `\`${opt}\``)
              .join(', ');
          } else {
            // Object array options with id/label
            optionsList = subBlock.options
              .filter(opt => typeof opt === 'object' && opt !== null && 'id' in opt)
              .map(opt => {
                const option = opt as any;
                return `\`${option.id}\` (${option.label || option.id})`;
              })
              .join(', ');
          }
        }
        description += optionsList ? `: ${optionsList}` : '';
      }
      
      return `| \`${id}\` | ${type} | ${required} | ${description} |`;
    }).join('\n');
  }

  // Create detailed options section for dropdowns
  const dropdownBlocks = subBlocks.filter(sb => 
    (sb.type === 'dropdown' || sb.options) && 
    Array.isArray(sb.options) && 
    sb.options.length > 0
  );
  
  let optionsSection = '';
  if (dropdownBlocks.length > 0) {
    optionsSection = `## Available Options\n\n`;
    
    dropdownBlocks.forEach(sb => {
      optionsSection += `### ${sb.title || sb.id} (${sb.id ? `\`${sb.id}\`` : ''})\n\n`;
      
      if (Array.isArray(sb.options)) {
        // Check the first item to determine the array type
        if (sb.options.length > 0) {
          if (typeof sb.options[0] === 'string') {
            // Handle string array
            sb.options.forEach((opt) => {
              if (typeof opt === 'string') {
                optionsSection += `- \`${opt}\`\n`;
              }
            });
          } else {
            // Handle object array with id/label properties
            sb.options.forEach((opt) => {
              if (typeof opt === 'object' && opt !== null && 'id' in opt) {
                const option = opt as any;
                optionsSection += `- \`${option.id}\`: ${option.label || option.id}\n`;
              }
            });
          }
        }
      }
      
      optionsSection += '\n';
    });
  }

  // Create outputs section with better handling of complex types
  let outputsSection = '';
  
  if (Object.keys(outputs).length > 0) {
    outputsSection = Object.entries(outputs).map(([key, config]) => {
      const outputConfig = config as OutputConfig;
      let outputTypeContent = '';
      
      if (typeof outputConfig.type === 'string') {
        outputTypeContent = `**Type:** \`${outputConfig.type}\``;
      } else if (outputConfig.type && typeof outputConfig.type === 'object') {
        outputTypeContent = '**Fields:**\n\n';
        
        Object.entries(outputConfig.type).forEach(([fieldName, fieldType]) => {
          outputTypeContent += `- \`${fieldName}\`: \`${fieldType}\`\n`;
        });
        
        outputTypeContent += '\n**Example:**\n\n```json\n' + 
          JSON.stringify({
            [key]: Object.entries(outputConfig.type).reduce((obj, [k, v]) => {
              obj[k] = getExampleValue(v as string);
              return obj;
            }, {} as Record<string, any>)
          }, null, 2) + '\n```';
      } else {
        outputTypeContent = 'Complex type';
      }
      
      return `### ${key}\n\n${outputTypeContent}`;
    }).join('\n\n');
  } else {
    outputsSection = 'This block does not produce any outputs.';
  }

  // Create tools section with more details
  let toolsSection = '';
  if (tools.access?.length) {
    toolsSection = `## Tools Used\n\n`;
    tools.access.forEach(tool => {
      toolsSection += `### \`${tool}\`\n\n`;
      
      // Try to find more information about the tool from the config
      if (tools.config && typeof tools.config.tool === 'function') {
        toolsSection += `This block uses the \`${tool}\` tool to process text and generate speech.\n\n`;
      }
    });
  }

  // Generate more comprehensive example code
  let exampleCode = `// Example of using the ${name} block\n{\n  type: "${type}"`;
  
  if (Object.keys(inputs).length > 0) {
    exampleCode += ',\n' + Object.entries(inputs).map(([key, config]) => {
      const inputConfig = config as InputConfig;
      return `  ${key}: ${getExampleInputValue(key, inputConfig, subBlocks)}`;
    }).join(',\n');
  } else if (subBlocks.length > 0) {
    // Generate example from subBlocks if no inputs
    const operationBlock = subBlocks.find(sb => sb.id === 'operation');
    if (operationBlock?.options && operationBlock.options.length > 0) {
      exampleCode += `,\n  operation: "${operationBlock.options[0].id}"`;
      
      // Add other fields based on selected operation
      const selectedOperation = operationBlock.options[0].id;
      const relevantBlocks = subBlocks.filter(sb => 
        !sb.condition || 
        (sb.condition.field === 'operation' && sb.condition.value === selectedOperation)
      );
      
      relevantBlocks.forEach(block => {
        if (block.id !== 'operation') {
          const exampleValue = getExampleValueForSubBlock(block);
          if (exampleValue) {
            exampleCode += `,\n  ${block.id}: ${exampleValue}`;
          }
        }
      });
    } else {
      // Add all fields as an example
      subBlocks.forEach(block => {
        if (block.id) {
          const exampleValue = getExampleValueForSubBlock(block);
          if (exampleValue) {
            exampleCode += `,\n  ${block.id}: ${exampleValue}`;
          }
        }
      });
    }
  }
  
  exampleCode += '\n}';

  // Add usage instructions if available in block config
  let usageInstructions = '';
  if (longDescription) {
    usageInstructions = `## Usage Instructions\n\n${longDescription}\n\n`;
    
    // Add any additional information about tools or setup
    if (tools.access?.length) {
      if (type === 'elevenlabs') {
        usageInstructions += `This block requires an API key to use the ElevenLabs service. Make sure to provide a valid API key in the configuration.\n\n`;
      } else {
        usageInstructions += `This block uses external API services and may require authentication credentials in the configuration.\n\n`;
      }
    }
  }

  // Generate the markdown content
  return `---
title: ${name}
description: ${description}
---

import { BlockInfoCard } from "@/components/ui/block-info-card";

<BlockInfoCard 
  type="${type}"
  color="${bgColor || '#F5F5F5'}"
  icon={${iconSvg ? 'true' : 'false'}}
  iconSvg={\`${iconSvg || ''}\`}
/>

${longDescription || description}

${usageInstructions}

${toolsSection}

## Configuration

${subBlocks.length > 0 ? '### Input Parameters\n\n' + 
'| Parameter | Type | Required | Description | \n' +
'| --------- | ---- | -------- | ----------- | \n' +
inputsTable : 'No configuration parameters required.'}

${optionsSection}

## Outputs

${outputsSection}

## Example Usage

\`\`\`typescript
${exampleCode}
\`\`\`

## Notes

- Category: \`${category}\`
- Type: \`${type}\`
${tools.access?.length ? `- Required Tools: ${tools.access.map(t => '`' + t + '`').join(', ')}` : ''}
`;
}

// Helper to get example value for a subBlock
function getExampleValueForSubBlock(subBlock: any): string | null {
  if (!subBlock.id) return null;
  
  // If it has options, use the first option
  if (subBlock.options && subBlock.options.length > 0) {
    return `"${subBlock.options[0].id}"`;
  }
  
  // Otherwise, base it on the type
  switch (subBlock.type) {
    case 'dropdown':
      return '"option1"';
    case 'short-input':
    case 'long-input':
      if (subBlock.id.includes('id')) return '"example-id"';
      if (subBlock.id.includes('credential')) return '"oauth-credential"';
      if (subBlock.id.includes('key')) return '"api-key"';
      if (subBlock.id.includes('content')) return '"Example content"';
      if (subBlock.id.includes('query')) return '"example search query"';
      if (subBlock.id.includes('url')) return '"https://example.com"';
      return '"example"';
    case 'number-input':
      return '42';
    case 'toggle':
      return 'true';
    case 'oauth-input':
      return '"oauth-credential"';
    case 'file-selector':
      return '"file-id"';
    default:
      return '"example"';
  }
}

// Helper to get example value based on type
function getExampleValue(type: string): any {
  switch (type.toLowerCase()) {
    case 'string':
      return 'example text';
    case 'number':
      return 42;
    case 'boolean':
      return true;
    case 'json':
      return { key: 'value' };
    case 'array':
    case 'string[]':
      return ['item1', 'item2'];
    default:
      return 'example';
  }
}

// Helper to get example input value
function getExampleInputValue(key: string, config: InputConfig, subBlocks: any[]): string {
  const subBlock = subBlocks.find(sb => sb.id === key);
  
  if (subBlock?.options && Array.isArray(subBlock.options) && subBlock.options.length > 0) {
    return `"${subBlock.options[0].id}"`;
  }
  
  if (key === 'operation' && subBlocks.find(sb => sb.id === 'operation')) {
    const operationBlock = subBlocks.find(sb => sb.id === 'operation');
    if (operationBlock?.options && Array.isArray(operationBlock.options) && operationBlock.options.length > 0) {
      return `"${operationBlock.options[0].id}"`;
    }
  }
  
  switch (config.type.toLowerCase()) {
    case 'string':
      if (key.includes('id')) return '"example-id"';
      if (key.includes('credential')) return '"oauth-credential"';
      if (key.includes('key')) return '"api-key"';
      if (key.includes('content')) return '"Example content"';
      if (key.includes('query')) return '"example search query"';
      if (key.includes('url')) return '"https://example.com"';
      return '"example"';
    case 'number':
      return '42';
    case 'boolean':
      return 'true';
    default:
      return '"example"';
  }
}

// Main function to generate all block docs
async function generateAllBlockDocs() {
  try {
    // Extract icons first
    const icons = extractIcons();
    
    // Get all block files
    console.log(`Searching for block files in: ${BLOCKS_PATH}`);
    const blockFiles = await glob(`${BLOCKS_PATH}/*.ts`);
    
    console.log(`Found ${blockFiles.length} block files`);
    
    // Generate docs for each block
    for (const blockFile of blockFiles) {
      await generateBlockDoc(blockFile, icons);
    }
    
    // Update the meta.json file
    updateMetaJson();
    
    console.log('Block documentation generation complete!');
    return true;
  } catch (error) {
    console.error('Error generating documentation:', error);
    return false;
  }
}

// Function to update the meta.json file with all blocks
function updateMetaJson() {
  const metaJsonPath = path.join(DOCS_OUTPUT_PATH, 'meta.json');
  
  // Get all MDX files in the tools directory
  console.log(`Reading directory: ${DOCS_OUTPUT_PATH}`);
  const blockFiles = fs.readdirSync(DOCS_OUTPUT_PATH)
    .filter((file: string) => file.endsWith('.mdx'))
    .map((file: string) => path.basename(file, '.mdx'));
  
  console.log(`Found ${blockFiles.length} documentation files`);
  
  // Create meta.json structure
  // Keep "index" as the first item if it exists
  const items = [
    ...(blockFiles.includes('index') ? ['index'] : []),
    ...blockFiles.filter((file: string) => file !== 'index').sort()
  ];
  
  const metaJson = {
    items
  };
  
  // Write the meta.json file
  fs.writeFileSync(metaJsonPath, JSON.stringify(metaJson, null, 2));
  
  console.log(`Updated ${metaJsonPath}`);
}

// Run the script
generateAllBlockDocs().then((success) => {
  if (success) {
    console.log('Documentation generation completed successfully');
    process.exit(0);
  } else {
    console.error('Documentation generation failed');
    process.exit(1);
  }
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 