# Sim Studio TypeScript SDK

The official TypeScript/JavaScript SDK for [Sim Studio](https://simstudio.ai), allowing you to execute workflows programmatically from your applications.

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
  baseUrl: 'https://simstudio.ai' // optional, defaults to https://simstudio.ai
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

- `config.apiKey` (string): Your Sim Studio API key
- `config.baseUrl` (string, optional): Base URL for the Sim Studio API (defaults to `https://simstudio.ai`)

#### Methods

##### executeWorkflow(workflowId, options?)

Execute a workflow with optional input data.

```typescript
const result = await client.executeWorkflow('workflow-id', {
  input: { message: 'Hello, world!' },
  timeout: 30000 // 30 seconds
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `options` (ExecutionOptions, optional):
  - `input` (any): Input data to pass to the workflow
  - `timeout` (number): Timeout in milliseconds (default: 30000)

**Returns:** `Promise<WorkflowExecutionResult>`

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

##### executeWorkflowSync(workflowId, options?)

Execute a workflow and poll for completion (useful for long-running workflows).

```typescript
const result = await client.executeWorkflowSync('workflow-id', {
  input: { data: 'some input' },
  timeout: 60000,
  pollInterval: 2000,
  maxWaitTime: 300000
});
```

**Parameters:**
- `workflowId` (string): The ID of the workflow to execute
- `options` (ExecutionOptions & polling options, optional):
  - `input` (any): Input data to pass to the workflow
  - `timeout` (number): Timeout for the initial request in milliseconds
  - `pollInterval` (number): Polling interval in milliseconds (default: 1000)
  - `maxWaitTime` (number): Maximum wait time in milliseconds (default: 300000)

**Returns:** `Promise<WorkflowExecutionResult>`

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
  isPublished: boolean;
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

## Examples

### Basic Workflow Execution

```typescript
import { SimStudioClient } from 'simstudio-ts-sdk';

const client = new SimStudioClient({
  apiKey: process.env.SIMSTUDIO_API_KEY!
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
      input: {
        message: 'Process this data',
        userId: '12345'
      }
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
  apiKey: process.env.SIMSTUDIO_API_KEY!
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
  apiKey: process.env.SIMSTUDIO_API_KEY!,
  baseUrl: process.env.SIMSTUDIO_BASE_URL // optional
});
```

## Getting Your API Key

1. Log in to your [Sim Studio](https://simstudio.ai) account
2. Navigate to your workflow
3. Click on "Deploy" to deploy your workflow
4. Select or create an API key during the deployment process
5. Copy the API key to use in your application

## License

Apache-2.0 