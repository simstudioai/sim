import { StagehandIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface StagehandExtractResponse extends ToolResponse {
  output: {
    data: Record<string, any>
  }
}

export const StagehandBlock: BlockConfig<StagehandExtractResponse> = {
  type: 'stagehand',
  name: 'Stagehand Extract',
  description: 'Extract data from websites',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages.',
  docsLink: 'https://docs.sim.ai/tools/stagehand',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'Enter the URL of the website to extract data from',
      required: true,
    },
    {
      id: 'instruction',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Enter detailed instructions for what data to extract from the page...',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'OpenAI API Key',
      type: 'short-input',
      placeholder: 'Enter your OpenAI API key',
      password: true,
      required: true,
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'code',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas for web scraping and data extraction.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1 (Product Extraction):
{
    "name": "product_info",
    "description": "Extracts product information from an e-commerce page",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The product name"
            },
            "price": {
                "type": "string",
                "description": "The product price"
            },
            "description": {
                "type": "string",
                "description": "The product description"
            }
        },
        "additionalProperties": false,
        "required": ["name", "price"]
    }
}

Example 2 (Article Extraction):
{
    "name": "article_content",
    "description": "Extracts article content from a news or blog page",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The article headline"
            },
            "author": {
                "type": "string",
                "description": "The article author"
            },
            "publishDate": {
                "type": "string",
                "description": "The publication date"
            },
            "content": {
                "type": "string",
                "description": "The main article text"
            }
        },
        "additionalProperties": false,
        "required": ["title", "content"]
    }
}

Example 3 (List Extraction):
{
    "name": "search_results",
    "description": "Extracts search results or list items from a page",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "List of extracted items",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Item title"
                        },
                        "url": {
                            "type": "string",
                            "description": "Item URL"
                        },
                        "snippet": {
                            "type": "string",
                            "description": "Brief description or snippet"
                        }
                    },
                    "additionalProperties": false,
                    "required": ["title"]
                }
            }
        },
        "additionalProperties": false,
        "required": ["items"]
    }
}
`,
        placeholder: 'Describe what data you want to extract from the webpage...',
        generationType: 'json-schema',
      },
    },
  ],
  tools: {
    access: ['stagehand_extract'],
    config: {
      tool: () => 'stagehand_extract',
    },
  },
  inputs: {
    url: { type: 'string', description: 'Website URL to extract' },
    instruction: { type: 'string', description: 'Extraction instructions' },
    schema: { type: 'json', description: 'JSON schema definition' },
    apiKey: { type: 'string', description: 'OpenAI API key' },
  },
  outputs: {
    data: { type: 'json', description: 'Extracted data' },
  },
}
