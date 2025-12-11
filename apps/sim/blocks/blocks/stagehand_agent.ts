import { StagehandIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { StagehandAgentResponse } from '@/tools/stagehand/types'

export const StagehandAgentBlock: BlockConfig<StagehandAgentResponse> = {
  type: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Autonomous web browsing agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Stagehand Agent into the workflow. Can navigate the web and perform tasks.',
  docsLink: 'https://docs.sim.ai/tools/stagehand_agent',
  category: 'tools',
  bgColor: '#FFC83C',
  icon: StagehandIcon,
  subBlocks: [
    {
      id: 'startUrl',
      title: 'Starting URL',
      type: 'short-input',
      placeholder: 'Enter the starting URL for the agent',
      required: true,
    },
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder:
        'Enter the task or goal for the agent to achieve. Reference variables using %key% syntax.',
      required: true,
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'table',
      columns: ['Key', 'Value'],
    },
    {
      id: 'apiKey',
      title: 'Anthropic API Key',
      type: 'short-input',
      placeholder: 'Enter your Anthropic API key',
      password: true,
      required: true,
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      placeholder: 'Enter JSON Schema...',
      language: 'json',
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
  ],
  tools: {
    access: ['stagehand_agent'],
    config: {
      tool: () => 'stagehand_agent',
    },
  },
  inputs: {
    startUrl: { type: 'string', description: 'Starting URL for agent' },
    task: { type: 'string', description: 'Task description' },
    variables: { type: 'json', description: 'Task variables' },
    apiKey: { type: 'string', description: 'Anthropic API key' },
    outputSchema: { type: 'json', description: 'Output schema' },
  },
  outputs: {
    agentResult: { type: 'json', description: 'Agent execution result' },
    structuredOutput: { type: 'json', description: 'Structured output data' },
  },
}
