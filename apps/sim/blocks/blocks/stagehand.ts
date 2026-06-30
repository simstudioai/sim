import { StagehandIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { StagehandAgentResponse, StagehandExtractResponse } from '@/tools/stagehand/types'

export type StagehandResponse = StagehandExtractResponse | StagehandAgentResponse

export const StagehandBlock: BlockConfig<StagehandResponse> = {
  type: 'stagehand',
  name: 'Stagehand',
  description: 'Web automation and data extraction',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Stagehand into the workflow. Can extract structured data from webpages or run an autonomous agent to perform tasks.',
  docsLink: 'https://docs.sim.ai/integrations/stagehand',
  category: 'tools',
  integrationType: IntegrationType.AI,
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
    {
      id: 'mode',
      title: 'Agent Mode',
      type: 'dropdown',
      options: [
        { label: 'DOM (default)', id: 'dom' },
        { label: 'Hybrid', id: 'hybrid' },
        { label: 'CUA', id: 'cua' },
      ],
      value: () => 'dom',
      condition: { field: 'operation', value: 'agent' },
      mode: 'advanced',
    },
    {
      id: 'maxSteps',
      title: 'Max Steps',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'agent' },
      mode: 'advanced',
    },
    // Shared API key field
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key for the selected provider',
      password: true,
      dependsOn: ['provider'],
      required: true,
    },
  ],
  tools: {
    access: ['stagehand_extract', 'stagehand_agent'],
    config: {
      tool: (params) => {
        return params.operation === 'agent' ? 'stagehand_agent' : 'stagehand_extract'
      },
      params: (params) => {
        const baseParams = {
          operation: params.operation,
          provider: params.provider,
          apiKey: params.apiKey,
        }

        if (params.operation !== 'agent') {
          return {
            ...baseParams,
            url: params.url,
            instruction: params.instruction,
            schema: params.schema,
          }
        }

        const maxStepsInput =
          typeof params.maxSteps === 'string' ? params.maxSteps.trim() : params.maxSteps
        const maxSteps = maxStepsInput === '' ? Number.NaN : Number(maxStepsInput)

        return {
          ...baseParams,
          startUrl: params.startUrl,
          task: params.task,
          variables: params.variables,
          outputSchema: params.outputSchema,
          mode: params.mode,
          maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
        }
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
    mode: { type: 'string', description: 'Agent mode: dom, hybrid, or cua (agent operation)' },
    maxSteps: { type: 'number', description: 'Max agent steps (agent operation)' },
  },
  outputs: {
    // Extract outputs
    data: { type: 'json', description: 'Extracted data (extract operation)' },
    // Agent outputs
    agentResult: { type: 'json', description: 'Agent execution result (agent operation)' },
    structuredOutput: { type: 'json', description: 'Structured output data (agent operation)' },
    liveViewUrl: {
      type: 'string',
      description: 'Embeddable Browserbase live view URL (agent operation)',
    },
    sessionId: { type: 'string', description: 'Browserbase session identifier (agent operation)' },
  },
}

export const StagehandBlockMeta = {
  tags: ['web-scraping', 'automation', 'agentic'],
  url: 'https://www.stagehand.dev',
  templates: [
    {
      icon: StagehandIcon,
      title: 'Stagehand QA navigator',
      prompt:
        'Build a workflow that uses Stagehand to run scripted browser flows against staging, captures screenshots and assertion outcomes per step, and writes a regression report file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand booking automator',
      prompt:
        'Create a workflow that uses Stagehand to log into supplier portals, place recurring orders from a tables-defined catalog, and write confirmation numbers back to the orders table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'ecommerce'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand price-monitor sweep',
      prompt:
        'Build a scheduled workflow that uses Stagehand to navigate a catalog of supplier sites, capture current prices and stock for items in a tracking table, and alert Slack on threshold breaches.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand competitor product trial',
      prompt:
        'Build a workflow that uses Stagehand to walk through competitor product trials weekly, captures screenshots of every step, and writes a UX-comparison file.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand onboarding-flow auditor',
      prompt:
        'Create a workflow that uses Stagehand to test the production onboarding flow daily, captures friction points, and writes a UX regression table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand structured lead extractor',
      prompt:
        'Build a workflow that uses Stagehand to visit a list of company sites from a table, extracts structured fields — company name, contact email, pricing tier, and key features — into a defined schema, and writes the clean records back into a research table for the sales team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: StagehandIcon,
      title: 'Stagehand autonomous task runner',
      prompt:
        'Create a workflow that hands Stagehand a natural-language goal like "find the latest pricing on this vendor site and download the PDF", lets the Stagehand agent navigate and act on the page autonomously, and saves the captured result and screenshots to files.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'research', 'agentic'],
    },
  ],
  skills: [
    {
      name: 'extract-structured-data',
      description:
        'Use Stagehand to extract structured fields from a web page into a typed result.',
      content:
        '# Extract Structured Data\n\nPull clean, structured data off a single web page.\n\n## Steps\n1. Run the Extract Data operation with the target URL.\n2. Describe exactly what to extract and the shape you want (for example product name, price, and availability), so Stagehand returns typed fields rather than raw HTML.\n3. Choose the LLM provider for the extraction.\n\n## Output\nReturn the extracted fields as a structured object, and note any field the page did not contain so downstream steps can handle gaps.',
    },
    {
      name: 'run-browser-agent-task',
      description:
        'Hand Stagehand a natural-language goal and let its agent navigate and act on a site autonomously.',
      content:
        '# Run Browser Agent Task\n\nDelegate a multi-step web task to the Stagehand agent.\n\n## Steps\n1. Run the Run Agent operation with a clear natural-language goal (for example find the latest pricing on a vendor site and capture it).\n2. Provide the starting URL and pick the execution mode (DOM, hybrid, or CUA) and the LLM provider appropriate to the task.\n3. Let the agent navigate, click, and read pages to complete the goal.\n\n## Output\nReturn the agent result, the key data it captured, and any screenshots, plus a short note if the goal could not be fully completed.',
    },
    {
      name: 'monitor-page-for-changes',
      description:
        'Periodically extract a value from a web page with Stagehand and report when it changes.',
      content:
        '# Monitor Page for Changes\n\nWatch a specific value on a web page over time.\n\n## Steps\n1. Run the Extract Data operation against the target URL, extracting just the value to watch (price, stock status, headline).\n2. Compare the extracted value against the last known value stored from a previous run.\n3. Decide whether the value changed beyond a meaningful threshold.\n\n## Output\nReport the current extracted value, whether it changed since the last check, and the old and new values when a change is detected.',
    },
  ],
} as const satisfies BlockMeta
