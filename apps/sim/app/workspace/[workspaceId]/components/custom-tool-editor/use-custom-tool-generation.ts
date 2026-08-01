'use client'

import { useMemo } from 'react'
import type { SchemaParameter } from '@/app/workspace/[workspaceId]/components/custom-tool-editor/custom-tool-schema'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'

const SCHEMA_PROMPT = `You are an expert programmer specializing in creating OpenAI function calling format JSON schemas for custom tools.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON schema MUST follow this specific format:
1. Top-level property "type" must be set to "function"
2. A "function" object containing:
   - "name": A concise, camelCase name for the function
   - "description": A clear description of what the function does
   - "parameters": A JSON Schema object describing the function's parameters with:
     - "type": "object"
     - "properties": An object containing parameter definitions
     - "required": An array of required parameter names

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
  "type": "function",
  "function": {
    "name": "getWeather",
    "description": "Fetches the current weather for a specific location.",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "The city and state, e.g., San Francisco, CA"
        },
        "unit": {
          "type": "string",
          "description": "Temperature unit",
          "enum": ["celsius", "fahrenheit"]
        }
      },
      "required": ["location"],
      "additionalProperties": false
    }
  }
}

Example 2:
{
  "type": "function",
  "function": {
    "name": "addItemToOrder",
    "description": "Add one quantity of a food item to the order.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemName": {
          "type": "string",
          "description": "The name of the food item to add to order"
        },
        "quantity": {
          "type": "integer",
          "description": "The quantity of the item to add",
          "default": 1
        }
      },
      "required": ["itemName"],
      "additionalProperties": false
    }
  }
}`

function buildCodePrompt(schemaContext: string): string {
  return `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Reference these directly by name (e.g., 'userId', 'cityName'). Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

${schemaContext}

Current code: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'const apiKey = {{SERVICE_API_KEY}};' not 'const apiKey = "{{SERVICE_API_KEY}}";'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Reference them directly by name (e.g., 'const city = cityName;' or use directly in template strings like \`\${cityName}\`). Do NOT wrap in quotes or angle brackets.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Do NOT include import/require statements unless they are standard Node.js built-in modules (e.g., 'crypto', 'fs'). External libraries are not supported in this context.
5. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch weather data from OpenWeather API. Use the city name passed in as 'cityName' and an API Key stored as the 'OPENWEATHER_API_KEY' environment variable."

Generated Code:
const apiKey = {{OPENWEATHER_API_KEY}};
const url = \`https://api.openweathermap.org/data/2.5/weather?q=\${cityName}&appid=\${apiKey}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const weatherData = await response.json();
  return weatherData;
} catch (error) {
  console.error(\`Error fetching weather data: \${error.message}\`);
  throw error;
}`
}

interface UseSchemaGenerationParams {
  jsonSchema: string
  setJsonSchema: (updater: (prev: string) => string) => void
  replaceJsonSchema: (value: string) => void
}

/** Wand-driven generation for a custom tool's JSON schema. */
export function useSchemaGeneration({
  jsonSchema,
  setJsonSchema,
  replaceJsonSchema,
}: UseSchemaGenerationParams) {
  return useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt: SCHEMA_PROMPT,
      placeholder: 'Describe the function parameters and structure...',
      generationType: 'custom-tool-schema',
    },
    currentValue: jsonSchema,
    onStreamStart: () => replaceJsonSchema(''),
    onGeneratedContent: (content) => replaceJsonSchema(content),
    onStreamChunk: (chunk) => setJsonSchema((prev) => prev + chunk),
  })
}

interface UseCodeGenerationParams {
  functionCode: string
  schemaParameters: SchemaParameter[]
  setFunctionCode: (updater: (prev: string) => string) => void
  replaceFunctionCode: (value: string) => void
}

/** Wand-driven generation for a custom tool's function body, aware of the schema's parameters. */
export function useCodeGeneration({
  functionCode,
  schemaParameters,
  setFunctionCode,
  replaceFunctionCode,
}: UseCodeGenerationParams) {
  const prompt = useMemo(() => {
    if (schemaParameters.length === 0) {
      return buildCodePrompt(
        'Schema parameters: (none defined yet — the user has not added any parameters to the schema)'
      )
    }
    const lines = schemaParameters.map((p) => {
      const requiredLabel = p.required ? 'required' : 'optional'
      const description = p.description ? `: ${p.description}` : ''
      return `- ${p.name} (${p.type}, ${requiredLabel})${description}`
    })
    return buildCodePrompt(
      `Schema parameters (reference these directly by name in the generated code):\n${lines.join('\n')}`
    )
  }, [schemaParameters])

  return useWand({
    wandConfig: {
      enabled: true,
      maintainHistory: true,
      prompt,
      placeholder: 'Describe the JavaScript function to generate...',
      generationType: 'javascript-function-body',
    },
    currentValue: functionCode,
    onStreamStart: () => replaceFunctionCode(''),
    onGeneratedContent: (content) => replaceFunctionCode(content),
    onStreamChunk: (chunk) => setFunctionCode((prev) => prev + chunk),
  })
}
