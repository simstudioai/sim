import { StagehandIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export interface StagehandExtractResponse extends ToolResponse {
  output: {
    data: Record<string, any>
  }
}

export interface StagehandAgentResponse extends ToolResponse {
  output: {
    agentResult: {
      success: boolean
      completed: boolean
      message: string
      actions?: Array<{
        type: string
        description: string
        result?: string
      }>
    }
    structuredOutput?: Record<string, any>
  }
}

export type StagehandResponse = StagehandExtractResponse | StagehandAgentResponse

export const StagehandBlock: BlockConfig<StagehandResponse> = {
  type: 'stagehand',
  name: 'Stagehand',
  description: 'Web automation and data extraction',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages or run an autonomous agent to perform tasks.',
  docsLink: 'https://docs.sim.ai/tools/stagehand',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    // Operation selection
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Extract Data', id: 'extract' },
        { label: 'Run Agent', id: 'agent' },
      ],
      value: () => 'extract',
    },
    // Provider selection
    {
      id: 'provider',
      title: 'AI Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'Anthropic', id: 'anthropic' },
      ],
      value: () => 'openai',
    },
    // Extract operation fields
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'Enter the URL of the website to extract data from',
      condition: { field: 'operation', value: 'extract' },
      required: true,
    },
    {
      id: 'instruction',
      title: 'Instructions',
      type: 'long-input',
      placeholder: 'Enter detailed instructions for what data to extract from the page...',
      condition: { field: 'operation', value: 'extract' },
      required: true,
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'code',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      condition: { field: 'operation', value: 'extract' },
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
    // Agent operation fields
    {
      id: 'startUrl',
      title: 'Starting URL',
      type: 'short-input',
      placeholder: 'Enter the starting URL for the agent',
      condition: { field: 'operation', value: 'agent' },
      required: true,
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder:
        'Enter the task or goal for the agent to achieve. Reference variables using %key% syntax.',
      condition: { field: 'operation', value: 'agent' },
      required: true,
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'table',
      columns: ['Key', 'Value'],
      condition: { field: 'operation', value: 'agent' },
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
      condition: { field: 'operation', value: 'agent' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas for web automation agents.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1 (Login Result):
{
    "name": "login_result",
    "description": "Result of a login task performed by the agent",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "Whether the login was successful"
            },
            "username": {
                "type": "string",
                "description": "The username that was logged in"
            },
            "dashboardUrl": {
                "type": "string",
                "description": "The URL of the dashboard after login"
            }
        },
        "additionalProperties": false,
        "required": ["success"]
    }
}

Example 2 (Form Submission):
{
    "name": "form_submission_result",
    "description": "Result of submitting a form",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "submitted": {
                "type": "boolean",
                "description": "Whether the form was submitted"
            },
            "confirmationNumber": {
                "type": "string",
                "description": "Confirmation or reference number if provided"
            },
            "errorMessage": {
                "type": "string",
                "description": "Error message if submission failed"
            }
        },
        "additionalProperties": false,
        "required": ["submitted"]
    }
}

Example 3 (Data Collection):
{
    "name": "collected_data",
    "description": "Data collected by the agent from multiple pages",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "List of collected items",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Item name"
                        },
                        "value": {
                            "type": "string",
                            "description": "Item value or content"
                        },
                        "sourceUrl": {
                            "type": "string",
                            "description": "URL where the item was found"
                        }
                    },
                    "additionalProperties": false,
                    "required": ["name"]
                }
            },
            "totalCount": {
                "type": "number",
                "description": "Total number of items collected"
            }
        },
        "additionalProperties": false,
        "required": ["items"]
    }
}
`,
        placeholder: 'Describe what output format you expect from the agent task...',
        generationType: 'json-schema',
      },
    },
    // Shared API key field
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key for the selected provider',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['stagehand_extract', 'stagehand_agent'],
    config: {
      tool: (params) => {
        return params.operation === 'agent' ? 'stagehand_agent' : 'stagehand_extract'
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation: extract or agent' },
    provider: { type: 'string', description: 'AI provider: openai or anthropic' },
    apiKey: { type: 'string', description: 'API key for the selected provider' },
    // Extract inputs
    url: { type: 'string', description: 'Website URL to extract (extract operation)' },
    instruction: { type: 'string', description: 'Extraction instructions (extract operation)' },
    schema: { type: 'json', description: 'JSON schema definition (extract operation)' },
    // Agent inputs
    startUrl: { type: 'string', description: 'Starting URL for agent (agent operation)' },
    task: { type: 'string', description: 'Task description (agent operation)' },
    variables: { type: 'json', description: 'Task variables (agent operation)' },
    outputSchema: { type: 'json', description: 'Output schema (agent operation)' },
  },
  outputs: {
    // Extract outputs
    data: { type: 'json', description: 'Extracted data (extract operation)' },
    // Agent outputs
    agentResult: { type: 'json', description: 'Agent execution result (agent operation)' },
    structuredOutput: { type: 'json', description: 'Structured output data (agent operation)' },
  },
}
