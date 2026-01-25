# Sim Python SDK

The official Python SDK for [Sim](https://sim.ai), allowing you to execute workflows programmatically from your Python applications.

## Installation

```bash
pip install simstudio-sdk
```

## Quick Start

```python
import os
from simstudio import SimStudioClient

# Initialize the client
client = SimStudioClient(
    api_key=os.getenv("SIM_API_KEY", "your-api-key-here"),
    base_url="https://sim.ai"  # optional, defaults to https://sim.ai
)

# Execute a workflow
try:
    result = client.execute_workflow("workflow-id")
    print("Workflow executed successfully:", result)
except Exception as error:
    print("Workflow execution failed:", error)
```

## API Reference

### SimStudioClient

#### Constructor

```python
SimStudioClient(api_key: str, base_url: str = "https://sim.ai")
```

- `api_key` (str): Your Sim API key
- `base_url` (str, optional): Base URL for the Sim API (defaults to `https://sim.ai`)

#### Methods

##### execute_workflow(workflow_id, input=None, *, timeout=30.0, stream=None, selected_outputs=None, async_execution=None)

Execute a workflow with optional input data.

```python
# With dict input (spread at root level of request body)
result = client.execute_workflow("workflow-id", {"message": "Hello, world!"})

# With primitive input (wrapped as { input: value })
result = client.execute_workflow("workflow-id", "NVDA")

# With options (keyword-only arguments)
result = client.execute_workflow("workflow-id", {"message": "Hello"}, timeout=60.0)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow. Dicts are spread at the root level, primitives/lists are wrapped in `{ input: value }`. File objects are automatically converted to base64.
- `timeout` (float, keyword-only): Timeout in seconds (default: 30.0)
- `stream` (bool, keyword-only): Enable streaming responses
- `selected_outputs` (list, keyword-only): Block outputs to stream (e.g., `["agent1.content"]`)
- `async_execution` (bool, keyword-only): Execute asynchronously and return execution ID

**Returns:** `WorkflowExecutionResult` or `AsyncExecutionResult`

##### get_workflow_status(workflow_id)

Get the status of a workflow (deployment status, etc.).

```python
status = client.get_workflow_status("workflow-id")
print("Is deployed:", status.is_deployed)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow

**Returns:** `WorkflowStatus`

##### validate_workflow(workflow_id)

Validate that a workflow is ready for execution.

```python
is_ready = client.validate_workflow("workflow-id")
if is_ready:
    # Workflow is deployed and ready
    pass
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow

**Returns:** `bool`

##### execute_workflow_sync(workflow_id, input=None, *, timeout=30.0, stream=None, selected_outputs=None)

Execute a workflow synchronously (ensures non-async mode).

```python
result = client.execute_workflow_sync("workflow-id", {"data": "some input"}, timeout=60.0)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow
- `timeout` (float, keyword-only): Timeout in seconds (default: 30.0)
- `stream` (bool, keyword-only): Enable streaming responses
- `selected_outputs` (list, keyword-only): Block outputs to stream (e.g., `["agent1.content"]`)

**Returns:** `WorkflowExecutionResult`

##### get_job_status(task_id)

Get the status of an async job.

```python
status = client.get_job_status("task-id-from-async-execution")
print("Job status:", status)
```

**Parameters:**
- `task_id` (str): The task ID returned from async execution

**Returns:** `dict`

##### execute_with_retry(workflow_id, input=None, *, timeout=30.0, stream=None, selected_outputs=None, async_execution=None, max_retries=3, initial_delay=1.0, max_delay=30.0, backoff_multiplier=2.0)

Execute a workflow with automatic retry on rate limit errors.

```python
result = client.execute_with_retry(
    "workflow-id",
    {"message": "Hello"},
    timeout=30.0,
    max_retries=3,
    initial_delay=1.0,
    max_delay=30.0,
    backoff_multiplier=2.0
)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input` (any, optional): Input data to pass to the workflow
- `timeout` (float, keyword-only): Timeout in seconds (default: 30.0)
- `stream` (bool, keyword-only): Enable streaming responses
- `selected_outputs` (list, keyword-only): Block outputs to stream
- `async_execution` (bool, keyword-only): Execute asynchronously
- `max_retries` (int, keyword-only): Maximum retry attempts (default: 3)
- `initial_delay` (float, keyword-only): Initial delay in seconds (default: 1.0)
- `max_delay` (float, keyword-only): Maximum delay in seconds (default: 30.0)
- `backoff_multiplier` (float, keyword-only): Backoff multiplier (default: 2.0)

**Returns:** `WorkflowExecutionResult` or `AsyncExecutionResult`

##### get_rate_limit_info()

Get current rate limit information from the last API response.

```python
rate_info = client.get_rate_limit_info()
if rate_info:
    print("Remaining requests:", rate_info.remaining)
```

**Returns:** `RateLimitInfo` or `None`

##### get_usage_limits()

Get current usage limits and quota information.

```python
limits = client.get_usage_limits()
print("Current usage:", limits.usage)
```

**Returns:** `UsageLimits`

##### set_api_key(api_key)

Update the API key.

```python
client.set_api_key("new-api-key")
```

##### set_base_url(base_url)

Update the base URL.

```python
client.set_base_url("https://my-custom-domain.com")
```

##### close()

Close the underlying HTTP session.

```python
client.close()
```

## Data Classes

### WorkflowExecutionResult

```python
@dataclass
class WorkflowExecutionResult:
    success: bool
    output: Optional[Any] = None
    error: Optional[str] = None
    logs: Optional[list] = None
    metadata: Optional[Dict[str, Any]] = None
    trace_spans: Optional[list] = None
    total_duration: Optional[float] = None
```

### WorkflowStatus

```python
@dataclass
class WorkflowStatus:
    is_deployed: bool
    deployed_at: Optional[str] = None
    needs_redeployment: bool = False
```

### SimStudioError

```python
class SimStudioError(Exception):
    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status
```

### AsyncExecutionResult

```python
@dataclass
class AsyncExecutionResult:
    success: bool
    task_id: str
    status: str  # 'queued'
    created_at: str
    links: Dict[str, str]
```

### RateLimitInfo

```python
@dataclass
class RateLimitInfo:
    limit: int
    remaining: int
    reset: int
    retry_after: Optional[int] = None
```

### UsageLimits

```python
@dataclass
class UsageLimits:
    success: bool
    rate_limit: Dict[str, Any]
    usage: Dict[str, Any]
```

## Examples

### Basic Workflow Execution

```python
import os
from simstudio import SimStudioClient

client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

def run_workflow():
    try:
        # Check if workflow is ready
        is_ready = client.validate_workflow("my-workflow-id")
        if not is_ready:
            raise Exception("Workflow is not deployed or ready")

        # Execute the workflow
        result = client.execute_workflow(
            "my-workflow-id",
            {
                "message": "Process this data",
                "user_id": "12345"
            }
        )

        if result.success:
            print("Output:", result.output)
            print("Duration:", result.metadata.get("duration") if result.metadata else None)
        else:
            print("Workflow failed:", result.error)
            
    except Exception as error:
        print("Error:", error)

run_workflow()
```

### Error Handling

```python
from simstudio import SimStudioClient, SimStudioError
import os

client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

def execute_with_error_handling():
    try:
        result = client.execute_workflow("workflow-id")
        return result
    except SimStudioError as error:
        if error.code == "UNAUTHORIZED":
            print("Invalid API key")
        elif error.code == "TIMEOUT":
            print("Workflow execution timed out")
        elif error.code == "USAGE_LIMIT_EXCEEDED":
            print("Usage limit exceeded")
        elif error.code == "INVALID_JSON":
            print("Invalid JSON in request body")
        else:
            print(f"Workflow error: {error}")
        raise
    except Exception as error:
        print(f"Unexpected error: {error}")
        raise
```

### Context Manager Usage

```python
from simstudio import SimStudioClient
import os

# Using context manager to automatically close the session
with SimStudioClient(api_key=os.getenv("SIM_API_KEY")) as client:
    result = client.execute_workflow("workflow-id")
    print("Result:", result)
# Session is automatically closed here
```

### Environment Configuration

```python
import os
from simstudio import SimStudioClient

# Using environment variables
client = SimStudioClient(
    api_key=os.getenv("SIM_API_KEY"),
    base_url=os.getenv("SIM_BASE_URL", "https://sim.ai")
)
```

### File Upload

File objects are automatically detected and converted to base64 format. Include them in your input under the field name matching your workflow's API trigger input format:

The SDK converts file objects to this format:
```python
{
  'type': 'file',
  'data': 'data:mime/type;base64,base64data',
  'name': 'filename',
  'mime': 'mime/type'
}
```

Alternatively, you can manually provide files using the URL format:
```python
{
  'type': 'url',
  'data': 'https://example.com/file.pdf',
  'name': 'file.pdf',
  'mime': 'application/pdf'
}
```

```python
from simstudio import SimStudioClient
import os

client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

# Upload a single file - include it under the field name from your API trigger
with open('document.pdf', 'rb') as f:
    result = client.execute_workflow(
        'workflow-id',
        {
            'documents': [f],  # Must match your workflow's "files" field name
            'instructions': 'Analyze this document'
        }
    )

# Upload multiple files
with open('doc1.pdf', 'rb') as f1, open('doc2.pdf', 'rb') as f2:
    result = client.execute_workflow(
        'workflow-id',
        {
            'attachments': [f1, f2],  # Must match your workflow's "files" field name
            'query': 'Compare these documents'
        }
    )
```

### Batch Workflow Execution

```python
from simstudio import SimStudioClient
import os

client = SimStudioClient(api_key=os.getenv("SIM_API_KEY"))

def execute_workflows_batch(workflow_data_pairs):
    """Execute multiple workflows with different input data."""
    results = []

    for workflow_id, workflow_input in workflow_data_pairs:
        try:
            # Validate workflow before execution
            if not client.validate_workflow(workflow_id):
                print(f"Skipping {workflow_id}: not deployed")
                continue

            result = client.execute_workflow(workflow_id, workflow_input)
            results.append({
                "workflow_id": workflow_id,
                "success": result.success,
                "output": result.output,
                "error": result.error
            })

        except Exception as error:
            results.append({
                "workflow_id": workflow_id,
                "success": False,
                "error": str(error)
            })

    return results

# Example usage
workflows = [
    ("workflow-1", {"type": "analysis", "data": "sample1"}),
    ("workflow-2", {"type": "processing", "data": "sample2"}),
]

results = execute_workflows_batch(workflows)
for result in results:
    print(f"Workflow {result['workflow_id']}: {'Success' if result['success'] else 'Failed'}")
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

1. Clone the repository and navigate to the Python SDK directory:
   ```bash
   cd packages/python-sdk
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install the package in development mode with test dependencies:
   ```bash
   pip install -e ".[dev]"
   ```

4. Run the tests:
   ```bash
   pytest tests/ -v
   ```

### Code Quality

Run code quality checks:

```bash
# Code formatting
black simstudio/

# Linting
flake8 simstudio/ --max-line-length=100

# Type checking
mypy simstudio/

# Import sorting
isort simstudio/
```

## Requirements

- Python 3.8+
- requests >= 2.25.0

## License

Apache-2.0 