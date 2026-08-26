# Sim TypeScript SDK

The official TypeScript/JavaScript SDK for [Sim](https://sim.ai), allowing you to execute workflows programmatically from your applications.

## Server compatibility

`0.2.x` talks to the v2 API and has no fallback to the older endpoints, so it requires a Sim deployment that serves `POST /api/v2/workflows/{id}/execute`. That surface is newer than the endpoints `0.1.x` used. If it is unavailable, `executeWorkflow` fails with `HTTP 404: Not Found` — upgrade the server or stay on `simstudio-ts-sdk@0.1.x`, which keeps using `/api/workflows/{id}/execute` and `/api/jobs/{id}`.

## Upgrading from 0.1.x to 0.2.0

`0.2.0` is a breaking release. It is a minor bump rather than a patch precisely so that `^0.1.2` does not pick it up — you upgrade when you choose to.

- **Requests move to `/api/v2`.** `executeWorkflow` posts to `/api/v2/workflows/{id}/execute`, sends the workflow input nested under `input`, and carries `async` / `executionTimeoutSeconds` in the body instead of the `X-Execution-Mode` and `X-Execution-Timeout-Seconds` headers.
- **`AsyncExecutionResult.jobId` is now `runId`,** and `executionId` has been removed from that interface. Replace `result.jobId` with `result.runId`.
- **`getJobStatus(taskId)` is legacy.** It still calls `/api/jobs/{taskId}` and only resolves IDs from a `0.1.x` async execution. For runs started by `0.2.x`, use `getWorkflowRun(workflowId, runId)`, which reads `/api/v2/workflows/{id}/runs/{runId}` and returns a typed `WorkflowRunStatus`.
- **A failed synchronous run now throws.** Previously it resolved with `{ success: false }`; it now rejects with a `SimStudioError` carrying the server's `error.code` and `error.message`. Any `if (!result.success)` branch that handled failures must move into a `catch`.
- **`success` is derived from the run status.** It is `true` for `completed` and `paused` runs only, so a run cancelled while it was in flight resolves with `success: false` rather than throwing. Combined with the point above: a rejection means the run failed, and a resolved `success: false` means it was cancelled.

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
// With object input (sent as the v2 input object)
const result = await client.executeWorkflow('workflow-id', {
  message: 'Hello, world!'
});

// With primitive input (sent as { input: { input: value } })
const result = await client.executeWorkflow('workflow-id', 'NVDA');

// With options
const result = await client.executeWorkflow('workflow-id', { message: 'Hello' }, {
  timeout: 60000,
  async: true,
  executionTimeoutSeconds: 3600
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow. Objects become the v2 `input` object; primitives and arrays become `{ input: value }` inside it. File objects are automatically converted to base64.
- `options` (ExecutionOptions, optional):
  - `timeout` (number): Timeout in milliseconds (default: 30000)
  - `stream` (boolean): Enable streaming responses
  - `selectedOutputs` (string[]): Block outputs to stream (e.g., `["agent1.content"]`)
  - `async` (boolean): Execute asynchronously and return a run ID
  - `executionTimeoutSeconds` (number): Server-side async execution cap from 1 to 604800 seconds. Requires `async: true` and cannot extend the account policy.

**Returns:** `Promise<WorkflowExecutionResult | AsyncExecutionResult>`

Synchronous executions that finish with `status: 'failed'` reject with `SimStudioError`.

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

##### getWorkflowRun(workflowId, runId, options?)

Get the status and optional outputs of a workflow run. Use the `runId` returned by async execution.

```typescript
const status = await client.getWorkflowRun('workflow-id', 'run-id', {
  includeOutput: true,
  selectedOutputs: ['agent.content']
});
console.log('Run status:', status.status);
```

**Parameters:**
- `workflowId` (string): The workflow ID
- `runId` (string): The run ID returned from async execution
- `options.includeOutput` (boolean, optional): Include the final output for completed executions
- `options.selectedOutputs` (string[], optional): Block output selectors to include

**Returns:** `Promise<WorkflowRunStatus>`

##### getJobStatus(jobId)

Get the status of a job created through the legacy async execution endpoint. New integrations should use `getWorkflowRun()` with a run ID.

```typescript
const status = await client.getJobStatus('legacy-job-id');
```

**Returns:** `Promise<JobStatusResult>`

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
  executionId?: string;
  output?: any;
  error?: string;
  logs?: any[];
  metadata?: {
    duration?: number;
    executionId?: string;
    runId?: string;
    startTime?: string;
    endTime?: string;
    [key: string]: any;
  };
  traceSpans?: any[];
  totalDuration?: number;
}
```

### LargeValueRef

Oversized execution values may be returned as a versioned reference inside `output`, `logs`, streaming events, or execution status responses.
The `key` field is an opaque execution-scoped server storage pointer, not a client-readable download URL.

```typescript
interface LargeValueRef {
  __simLargeValueRef: true;
  version: 1;
  id: string;
  kind: 'array' | 'object' | 'string' | 'json';
  size: number;
  key?: string;
  executionId?: string;
  preview?: unknown;
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
  runId: string;
  statusUrl: string;
  message: string;
  async: true;
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
  executionTimeoutSeconds?: number;
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
