# Sim TypeScript SDK

The official TypeScript/JavaScript SDK for [Sim](https://sim.ai), allowing you to execute workflows programmatically from your applications.

## Installation

```bash
npm install simstudio-ts-sdk
# or 
yarn add simstudio-ts-sdk
# or
bun add simstudio-ts-sdk
```

## Quick Start

```typescript
import { SimStudioClient } from 'simstudio-ts-sdk';

// Initialize the client
const client = new SimStudioClient({
  apiKey: 'your-api-key-here',
  baseUrl: 'https://sim.ai' // optional, defaults to https://sim.ai
});

// Execute a workflow
try {
  const result = await client.executeWorkflow('workflow-id');
  console.log('Workflow executed successfully:', result);
} catch (error) {
  console.error('Workflow execution failed:', error);
}
```

## API Reference

### SimStudioClient

#### Constructor

```typescript
new SimStudioClient(config: SimStudioConfig)
```

- `config.apiKey` (string): Your Sim API key
- `config.baseUrl` (string, optional): Base URL for the Sim API (defaults to `https://sim.ai`)

#### Methods

##### executeWorkflow(workflowId, input?, options?)

Execute a workflow with optional input data.

```typescript
// With object input (spread at root level of request body)
const result = await client.executeWorkflow('workflow-id', {
  message: 'Hello, world!'
});

// With primitive input (wrapped as { input: value })
const result = await client.executeWorkflow('workflow-id', 'NVDA');

// With options
const result = await client.executeWorkflow('workflow-id', { message: 'Hello' }, {
  timeout: 60000
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow. Objects are spread at the root level, primitives/arrays are wrapped in `{ input: value }`. File objects are automatically converted to base64.
- `options` (ExecutionOptions, optional):
  - `timeout` (number): Timeout in milliseconds (default: 30000)
  - `stream` (boolean): Enable streaming responses
  - `selectedOutputs` (string[]): Block outputs to stream (e.g., `["agent1.content"]`)
  - `async` (boolean): Execute asynchronously and return execution ID

**Returns:** `Promise<WorkflowExecutionResult | AsyncExecutionResult>`

##### getWorkflowStatus(workflowId)

Get the status of a workflow (deployment status, etc.).

```typescript
const status = await client.getWorkflowStatus('workflow-id');
console.log('Is deployed:', status.isDeployed);
```

**Parameters:**
- `workflowId` (string): The ID of the workflow

**Returns:** `Promise<WorkflowStatus>`

##### validateWorkflow(workflowId)

Validate that a workflow is ready for execution.

```typescript
const isReady = await client.validateWorkflow('workflow-id');
if (isReady) {
  // Workflow is deployed and ready
}
```

**Parameters:**
- `workflowId` (string): The ID of the workflow

**Returns:** `Promise<boolean>`

##### executeWorkflowSync(workflowId, input?, options?)

Execute a workflow and poll for completion (useful for long-running workflows).

```typescript
const result = await client.executeWorkflowSync('workflow-id', { data: 'some input' }, {
  timeout: 60000
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow
- `options` (ExecutionOptions, optional):
  - `timeout` (number): Timeout for the initial request in milliseconds

**Returns:** `Promise<WorkflowExecutionResult>`

##### getJobStatus(taskId)

Get the status of an async job.

```typescript
const status = await client.getJobStatus('task-id-from-async-execution');
console.log('Job status:', status);
```

**Parameters:**
- `taskId` (string): The task ID returned from async execution

**Returns:** `Promise<any>`

##### executeWithRetry(workflowId, input?, options?, retryOptions?)

Execute a workflow with automatic retry on rate limit errors.

```typescript
const result = await client.executeWithRetry('workflow-id', { message: 'Hello' }, {
  timeout: 30000
}, {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow
- `options` (ExecutionOptions, optional): Execution options
- `retryOptions` (RetryOptions, optional):
  - `maxRetries` (number): Maximum retry attempts (default: 3)
  - `initialDelay` (number): Initial delay in ms (default: 1000)
  - `maxDelay` (number): Maximum delay in ms (default: 30000)
  - `backoffMultiplier` (number): Backoff multiplier (default: 2)

**Returns:** `Promise<WorkflowExecutionResult | AsyncExecutionResult>`

##### getRateLimitInfo()

Get current rate limit information from the last API response.

```typescript
const rateInfo = client.getRateLimitInfo();
if (rateInfo) {
  console.log('Remaining requests:', rateInfo.remaining);
}
```

**Returns:** `RateLimitInfo | null`

##### getUsageLimits()

Get current usage limits and quota information.

```typescript
const limits = await client.getUsageLimits();
console.log('Current usage:', limits.usage);
```

**Returns:** `Promise<UsageLimits>`

##### setApiKey(apiKey)

Update the API key.

```typescript
client.setApiKey('new-api-key');
```

##### setBaseUrl(baseUrl)

Update the base URL.

```typescript
client.setBaseUrl('https://my-custom-domain.com');
```

## Types

### WorkflowExecutionResult

```typescript
interface WorkflowExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  logs?: any[];
  metadata?: {
    duration?: number;
    executionId?: string;
    [key: string]: any;
  };
  traceSpans?: any[];
  totalDuration?: number;
}
```

### WorkflowStatus

```typescript
interface WorkflowStatus {
  isDeployed: boolean;
  deployedAt?: string;
  needsRedeployment: boolean;
}
```

### SimStudioError

```typescript
class SimStudioError extends Error {
  code?: string;
  status?: number;
}
```

### AsyncExecutionResult

```typescript
interface AsyncExecutionResult {
  success: boolean;
  taskId: string;
  status: 'queued';
  createdAt: string;
  links: {
    status: string;
  };
}
```

### RateLimitInfo

```typescript
interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}
```

### UsageLimits

```typescript
interface UsageLimits {
  success: boolean;
  rateLimit: {
    sync: {
      isLimited: boolean;
      limit: number;
      remaining: number;
      resetAt: string;
    };
    async: {
      isLimited: boolean;
      limit: number;
      remaining: number;
      resetAt: string;
    };
    authType: string;
  };
  usage: {
    currentPeriodCost: number;
    limit: number;
    plan: string;
  };
}
```

### ExecutionOptions

```typescript
interface ExecutionOptions {
  timeout?: number;
  stream?: boolean;
  selectedOutputs?: string[];
  async?: boolean;
}
```

### RetryOptions

```typescript
interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}
```

## Examples

### Basic Workflow Execution

```typescript
import { SimStudioClient } from 'simstudio-ts-sdk';

const client = new SimStudioClient({
  apiKey: process.env.SIM_API_KEY!
});

async function runWorkflow() {
  try {
    // Check if workflow is ready
    const isReady = await client.validateWorkflow('my-workflow-id');
    if (!isReady) {
      throw new Error('Workflow is not deployed or ready');
    }

    // Execute the workflow
    const result = await client.executeWorkflow('my-workflow-id', {
      message: 'Process this data',
      userId: '12345'
    });

    if (result.success) {
      console.log('Output:', result.output);
      console.log('Duration:', result.metadata?.duration);
    } else {
      console.error('Workflow failed:', result.error);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

runWorkflow();
```

### Error Handling

```typescript
import { SimStudioClient, SimStudioError } from 'simstudio-ts-sdk';

const client = new SimStudioClient({
  apiKey: process.env.SIM_API_KEY!
});

async function executeWithErrorHandling() {
  try {
    const result = await client.executeWorkflow('workflow-id');
    return result;
  } catch (error) {
    if (error instanceof SimStudioError) {
      switch (error.code) {
        case 'UNAUTHORIZED':
          console.error('Invalid API key');
          break;
        case 'TIMEOUT':
          console.error('Workflow execution timed out');
          break;
        case 'USAGE_LIMIT_EXCEEDED':
          console.error('Usage limit exceeded');
          break;
        case 'INVALID_JSON':
          console.error('Invalid JSON in request body');
          break;
        default:
          console.error('Workflow error:', error.message);
      }
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  }
}
```

### Environment Configuration

```typescript
// Using environment variables
const client = new SimStudioClient({
  apiKey: process.env.SIM_API_KEY!,
  baseUrl: process.env.SIM_BASE_URL // optional
});
```

### File Upload

File objects are automatically detected and converted to base64 format. Include them in your input under the field name matching your workflow's API trigger input format:

The SDK converts File objects to this format:
```typescript
{
  type: 'file',
  data: 'data:mime/type;base64,base64data',
  name: 'filename',
  mime: 'mime/type'
}
```

Alternatively, you can manually provide files using the URL format:
```typescript
{
  type: 'url',
  data: 'https://example.com/file.pdf',
  name: 'file.pdf',
  mime: 'application/pdf'
}
```

```typescript
import { SimStudioClient } from 'simstudio-ts-sdk';
import fs from 'fs';

const client = new SimStudioClient({
  apiKey: process.env.SIM_API_KEY!
});

// Node.js: Read file and create File object
const fileBuffer = fs.readFileSync('./document.pdf');
const file = new File([fileBuffer], 'document.pdf', { type: 'application/pdf' });

// Include files under the field name from your API trigger's input format
const result = await client.executeWorkflow('workflow-id', {
  documents: [file],  // Field name must match your API trigger's file input field
  instructions: 'Process this document'
});

// Browser: From file input
const handleFileUpload = async (event: Event) => {
  const inputEl = event.target as HTMLInputElement;
  const files = Array.from(inputEl.files || []);

  const result = await client.executeWorkflow('workflow-id', {
    attachments: files,  // Field name must match your API trigger's file input field
    query: 'Analyze these files'
  });
};
```

## Getting Your API Key

1. Log in to your [Sim](https://sim.ai) account
2. Navigate to your workflow
3. Click on "Deploy" to deploy your workflow
4. Select or create an API key during the deployment process
5. Copy the API key to use in your application

## Development

### Running Tests

To run the tests locally:

1. Clone the repository and navigate to the TypeScript SDK directory:
   ```bash
   cd packages/ts-sdk
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Run the tests:
   ```bash
   bun run test
   ```

### Building

Build the TypeScript SDK:

```bash
bun run build
```

This will compile TypeScript files to JavaScript and generate type declarations in the `dist/` directory.

### Development Mode

For development with auto-rebuild:

```bash
bun run dev
```

## Requirements

- Node.js 18+
- TypeScript 5.0+ (for TypeScript projects)

## License

Apache-2.0 