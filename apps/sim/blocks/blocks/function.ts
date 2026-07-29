import { CodeIcon } from '@/components/icons'
import { CodeLanguage, getLanguageDisplayName } from '@/lib/execution/languages'
import {
  fetchWorkspaceSandboxOption,
  fetchWorkspaceSandboxOptions,
  fetchWorkspaceSecretNameOptions,
} from '@/lib/workflows/subblocks/options'
import type { BlockConfig } from '@/blocks/types'
import type { CodeExecutionOutput } from '@/tools/function/types'

export const FunctionBlock: BlockConfig<CodeExecutionOutput> = {
  type: 'function',
  name: 'Function',
  description: 'Run custom logic',
  longDescription:
    'This is a core workflow block. Execute custom JavaScript or Python code within your workflow. JavaScript without imports runs locally for fast execution, while code with imports or Python runs in a remote sandbox.',
  bestPractices: `
  - JavaScript code without external imports runs in a local VM for fastest execution.
  - JavaScript code with import/require statements runs in a remote sandbox.
  - Python code always runs in a remote sandbox.
  - To import third-party packages, create a sandbox in Settings > Sandboxes and select it under the block's advanced options. Without one, only the standard library and built-in modules are available.
  - Can reference workflow variables using <blockName.output> syntax as usual within code. Avoid XML/HTML tags.
  `,
  docsLink: 'https://docs.sim.ai/workflows/blocks/function',
  category: 'blocks',
  bgColor: '#FF402F',
  icon: CodeIcon,
  subBlocks: [
    {
      id: 'language',
      type: 'dropdown',
      options: [
        { label: getLanguageDisplayName(CodeLanguage.JavaScript), id: CodeLanguage.JavaScript },
        { label: getLanguageDisplayName(CodeLanguage.Python), id: CodeLanguage.Python },
      ],
      placeholder: 'Select language',
      value: () => CodeLanguage.JavaScript,
      showWhenEnvSet: 'NEXT_PUBLIC_SANDBOX_ENABLED,NEXT_PUBLIC_E2B_ENABLED',
    },
    {
      id: 'code',
      title: 'Code',
      type: 'code',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JavaScript programmer.
Generate ONLY the raw body of a JavaScript function based on the user's request. Never wrap in markdown formatting.
The code should be executable within an 'async function(params, environmentVariables) {...}' context.
- 'params' (object): Contains input parameters derived from the JSON schema. Access these directly using the parameter name wrapped in angle brackets, e.g., '<paramName>'. Do NOT use 'params.paramName'.
- 'environmentVariables' (object): Contains environment variables. Reference these using the double curly brace syntax: '{{ENV_VAR_NAME}}'. Do NOT use 'environmentVariables.VAR_NAME' or env.

Current code context: {context}

IMPORTANT FORMATTING RULES:
1. Reference Environment Variables: Use the exact syntax {{VARIABLE_NAME}}. Do NOT wrap it in quotes (e.g., use 'apiKey = {{SERVICE_API_KEY}}' not 'apiKey = "{{SERVICE_API_KEY}}"'). Our system replaces these placeholders before execution.
2. Reference Input Parameters/Workflow Variables: Use the exact syntax <variable_name>. Do NOT wrap it in quotes (e.g., use 'userId = <userId>;' not 'userId = "<userId>";'). This includes parameters defined in the block's schema and outputs from previous blocks.
3. Function Body ONLY: Do NOT include the function signature (e.g., 'async function myFunction() {' or the surrounding '}').
4. Imports: Standard Node.js built-in modules (e.g., 'crypto', 'fs') are always available. Third-party packages are available ONLY when the block has a sandbox selected — the sandbox's package list is appended below when one is. Never import a package that is not on that list.
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
    {
      id: 'sandboxId',
      title: 'Sandbox',
      type: 'combobox',
      mode: 'advanced',
      searchable: true,
      // Empty means the default image — the picker must never auto-select for us.
      emptyIsValid: true,
      // Refetched whenever `language` changes, so the list is always scoped to
      // sandboxes this block can actually run in.
      dependsOn: ['language'],
      showWhenEnvSet: 'NEXT_PUBLIC_SANDBOX_ENABLED,NEXT_PUBLIC_E2B_ENABLED',
      placeholder: 'Default image (no extra packages)',
      description:
        'Packages this block can import. Manage sandboxes in Settings > Sandboxes. Leaving this empty runs on the default image.',
      options: [],
      fetchOptions: (blockId) => fetchWorkspaceSandboxOptions(blockId),
      fetchOptionById: (blockId, optionId) => fetchWorkspaceSandboxOption(blockId, optionId),
    },
    {
      id: 'secretScope',
      title: 'Secret access',
      type: 'dropdown',
      // Only meaningful when an agent calls this block as a tool.
      context: 'tool-input',
      paramVisibility: 'user-only',
      options: [
        { label: 'All secrets', id: 'all' },
        { label: 'Selected secrets', id: 'selected' },
      ],
      value: () => 'all',
      description:
        'Code can read any workspace secret, including ones added later. Narrow this to advertise a specific set to the model.',
    },
    {
      id: 'mountedSecrets',
      title: 'Secrets',
      type: 'dropdown',
      context: 'tool-input',
      paramVisibility: 'user-only',
      multiSelect: true,
      searchable: true,
      options: [],
      condition: { field: 'secretScope', value: 'selected' },
      placeholder: 'Select secrets this tool can read',
      fetchOptions: () => fetchWorkspaceSecretNameOptions(),
    },
  ],
  tools: {
    access: ['function_execute'],
  },
  inputs: {
    code: { type: 'string', description: 'JavaScript or Python code to execute' },
    language: { type: 'string', description: 'Language (javascript or python)' },
    timeout: { type: 'number', description: 'Execution timeout' },
    sandboxId: { type: 'string', description: 'Workspace sandbox providing importable packages' },
    secretScope: { type: 'string', description: 'Secret access mode: all or selected' },
    mountedSecrets: {
      type: 'json',
      description: 'Workspace secret names this block may read when secretScope is selected',
    },
  },
  outputs: {
    result: { type: 'json', description: 'Return value from the executed JavaScript function' },
    stdout: {
      type: 'string',
      description: 'Console log output and debug messages from function execution',
    },
  },
}
