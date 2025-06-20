# Sim Studio Python SDK

The official Python SDK for [Sim Studio](https://simstudio.ai), allowing you to execute workflows programmatically from your Python applications.

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
    api_key=os.getenv("SIMSTUDIO_API_KEY", "your-api-key-here"),
    base_url="https://simstudio.ai"  # optional, defaults to https://simstudio.ai
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
SimStudioClient(api_key: str, base_url: str = "https://simstudio.ai")
```

- `api_key` (str): Your Sim Studio API key
- `base_url` (str, optional): Base URL for the Sim Studio API (defaults to `https://simstudio.ai`)

#### Methods

##### execute_workflow(workflow_id, input_data=None, timeout=30.0)

Execute a workflow with optional input data.

```python
result = client.execute_workflow(
    "workflow-id",
    input_data={"message": "Hello, world!"},
    timeout=30.0  # 30 seconds
)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input_data` (dict, optional): Input data to pass to the workflow
- `timeout` (float): Timeout in seconds (default: 30.0)

**Returns:** `WorkflowExecutionResult`

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

##### execute_workflow_sync(workflow_id, input_data=None, timeout=30.0)

Execute a workflow and poll for completion (useful for long-running workflows).

```python
result = client.execute_workflow_sync(
    "workflow-id",
    input_data={"data": "some input"},
    timeout=60.0
)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input_data` (dict, optional): Input data to pass to the workflow
- `timeout` (float): Timeout for the initial request in seconds

**Returns:** `WorkflowExecutionResult`

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
    is_published: bool = False
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

## Examples

### Basic Workflow Execution

```python
import os
from simstudio import SimStudioClient

client = SimStudioClient(api_key=os.getenv("SIMSTUDIO_API_KEY"))

def run_workflow():
    try:
        # Check if workflow is ready
        is_ready = client.validate_workflow("my-workflow-id")
        if not is_ready:
            raise Exception("Workflow is not deployed or ready")

        # Execute the workflow
        result = client.execute_workflow(
            "my-workflow-id",
            input_data={
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

client = SimStudioClient(api_key=os.getenv("SIMSTUDIO_API_KEY"))

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
with SimStudioClient(api_key=os.getenv("SIMSTUDIO_API_KEY")) as client:
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
    api_key=os.getenv("SIMSTUDIO_API_KEY"),
    base_url=os.getenv("SIMSTUDIO_BASE_URL", "https://simstudio.ai")
)
```

### Batch Workflow Execution

```python
from simstudio import SimStudioClient
import os

client = SimStudioClient(api_key=os.getenv("SIMSTUDIO_API_KEY"))

def execute_workflows_batch(workflow_data_pairs):
    """Execute multiple workflows with different input data."""
    results = []
    
    for workflow_id, input_data in workflow_data_pairs:
        try:
            # Validate workflow before execution
            if not client.validate_workflow(workflow_id):
                print(f"Skipping {workflow_id}: not deployed")
                continue
                
            result = client.execute_workflow(workflow_id, input_data)
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

1. Log in to your [Sim Studio](https://simstudio.ai) account
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