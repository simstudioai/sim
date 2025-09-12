import { CodeIcon } from '@/components/icons'
import { CodeLanguage, getLanguageDisplayName } from '@/lib/execution/languages'
import type { BlockConfig } from '@/blocks/types'
import type { CodeExecutionOutput } from '@/tools/function/types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  longDescription:
    'This is a core workflow block. Execute custom JavaScript or Python code within your workflow. Use E2B for remote execution with imports or enable Fast Mode (bolt) to run JavaScript locally for lowest latency.',
  docsLink: 'https://docs.sim.ai/blocks/function',
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  subBlocks: [
    {
      id: 'remoteExecution',
      type: 'switch',
      layout: 'full',
      title: 'Remote Code Execution',
      description: 'Python/Javascript code run in a sandbox environment. Slower execution times.',
    },
    {
      id: 'language',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: getLanguageDisplayName(CodeLanguage.JavaScript), id: CodeLanguage.JavaScript },
        { label: getLanguageDisplayName(CodeLanguage.Python), id: CodeLanguage.Python },
      ],
      placeholder: 'Select language',
      value: () => CodeLanguage.JavaScript,
      condition: {
        field: 'remoteExecution',
        value: true,
      },
    },
    {
      id: 'code',
      type: 'code',
      layout: 'full',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'apiKey = {{SERVICE_API_KEY}}' not 'apiKey = "{{SERVICE_API_KEY}}"'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Do NOT include import/require statements unless they are standard Node.js built-in modules (e.g., 'crypto', 'fs'). External libraries are not supported in this context.
5. Output: Ensure the code returns a value if the function is expected to produce output. Use 'return'.
6. Clarity: Write clean, readable code.
7. No Explanations: Do NOT include markdown formatting, comments explaining the rules, or any text other than the raw JavaScript code for the function body.

Example Scenario:
User Prompt: "Fetch user data from an API. Use the User ID passed in as 'userId' and an API Key stored as the 'SERVICE_API_KEY' environment variable."

Generated Code:
const userId = <block.content>; // Correct: Accessing input parameter without quotes
const apiKey = {{SERVICE_API_KEY}}; // Correct: Accessing environment variable without quotes
const url = \`https://api.example.com/users/\${userId}\`;

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    // Throwing an error will mark the block execution as failed
    throw new Error(\`API request failed with status \${response.status}: \${await response.text()}\`);
  }

  const data = await response.json();
  console.log('User data fetched successfully.'); // Optional: logging for debugging
  return data; // Return the fetched data which becomes the block's output
} catch (error) {
  console.error(\`Error fetching user data: \${error.message}\`);
  // Re-throwing the error ensures the workflow knows this step failed.
  throw error;
}`,
        placeholder: 'Describe the function you want to create...',
        generationType: 'javascript-function-body',
      },
    },
  ],
  tools: {
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', description: 'JavaScript or Python code to execute' },
    remoteExecution: { type: 'boolean', description: 'Use E2B remote execution' },
    language: { type: 'string', description: 'Language (javascript or python)' },
    timeout: { type: 'number', description: 'Execution timeout' },
  },
  outputs: {
    result: { type: 'json', description: 'Return value from the executed JavaScript function' },
    stdout: {
      type: 'string',
      description: 'Console log output and debug messages from function execution',
    },
  },
}
