"""
Sim SDK for Python

Official Python SDK for Sim, allowing you to execute workflows programmatically.
"""

from typing import Any, Dict, Optional, Union
from dataclasses import dataclass
from datetime import datetime
import time
import random
import os

import requests

MAX_EXECUTION_TIMEOUT_SECONDS = 604_800

# Run statuses that count as a successful synchronous execution. Deliberately a
# whitelist: a status later added to the API then defaults to "not successful"
# rather than silently reporting True.
_SUCCESSFUL_RUN_STATUSES = ('completed', 'paused')

__version__ = "0.2.0"
__all__ = [
    "SimStudioClient",
    "SimStudioError",
    "WorkflowExecutionResult",
    "WorkflowStatus",
    "AsyncExecutionResult",
    "RateLimitInfo",
    "UsageLimits",
]


@dataclass
class WorkflowExecutionResult:
    """
    Result of a workflow execution.

    ``success`` is True only for the 'completed' and 'paused' statuses, so a
    run the server cancels and a run that fails both report False. Read
    ``status`` to tell those apart -- it carries the server's own terminal
    status ('completed', 'failed', 'paused' or 'cancelled').
    """
    success: bool
    output: Optional[Any] = None
    error: Optional[str] = None
    logs: Optional[list] = None
    metadata: Optional[Dict[str, Any]] = None
    trace_spans: Optional[list] = None
    total_duration: Optional[float] = None
    status: Optional[str] = None


@dataclass
class WorkflowStatus:
    """Status of a workflow."""
    is_deployed: bool
    deployed_at: Optional[str] = None
    needs_redeployment: bool = False


@dataclass
class AsyncExecutionResult:
    """Result of an async workflow execution."""
    success: bool
    run_id: str
    status_url: str
    message: str = ""
    async_execution: bool = True


@dataclass
class RateLimitInfo:
    """
    Rate limit information from API response headers.

    ``reset`` is epoch milliseconds when the server sends the ISO 8601
    ``X-RateLimit-Reset`` the v2 API uses, and epoch seconds for the bare
    integer older endpoints sent. ``retry_after`` is milliseconds.
    """
    limit: int
    remaining: int
    reset: int
    retry_after: Optional[int] = None


@dataclass
class UsageLimits:
    """Usage limits and quota information."""
    success: bool
    rate_limit: Dict[str, Any]
    usage: Dict[str, Any]


class SimStudioError(Exception):
    """Exception raised for Sim API errors."""
    
    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _parse_reset_header(value: str) -> int:
    """
    Parse the ``X-RateLimit-Reset`` header, matching the TypeScript SDK.

    The v2 API sends an ISO 8601 timestamp, which yields epoch milliseconds;
    older endpoints sent an epoch integer, which is kept as-is. A quota hint
    must never take down the call it rode in on, so an unrecognised value
    degrades to 0 rather than raising.
    """
    if value.isdecimal():
        return int(value)
    try:
        return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return 0


class SimStudioClient:
    """
    Sim API client for executing workflows programmatically.
    
    Args:
        api_key: Your Sim API key
        base_url: Base URL for the Sim API (defaults to https://sim.ai)
    """
    
    def __init__(self, api_key: str, base_url: str = "https://sim.ai"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self._session = requests.Session()
        self._session.headers.update({
            'X-API-Key': self.api_key,
            'Content-Type': 'application/json',
        })
        self._rate_limit_info: Optional[RateLimitInfo] = None
    
    def _convert_files_to_base64(self, value: Any) -> Any:
        """
        Convert file objects in input to API format (base64).
        Recursively processes nested dicts and lists.
        """
        import base64

        # Check if this is a file-like object
        if hasattr(value, 'read') and callable(value.read):
            # Save current position if seekable
            initial_pos = value.tell() if hasattr(value, 'tell') else None

            # Read file bytes
            file_bytes = value.read()

            # Restore position if seekable
            if initial_pos is not None and hasattr(value, 'seek'):
                value.seek(initial_pos)

            # Encode to base64
            base64_data = base64.b64encode(file_bytes).decode('utf-8')

            # Get file metadata
            filename = getattr(value, 'name', 'file')
            if isinstance(filename, str):
                filename = os.path.basename(filename)

            content_type = getattr(value, 'content_type', 'application/octet-stream')

            return {
                'type': 'file',
                'data': f'data:{content_type};base64,{base64_data}',
                'name': filename,
                'mime': content_type
            }

        # Recursively process lists
        if isinstance(value, list):
            return [self._convert_files_to_base64(item) for item in value]

        # Recursively process dicts
        if isinstance(value, dict):
            return {k: self._convert_files_to_base64(v) for k, v in value.items()}

        return value

    def execute_workflow(
        self,
        workflow_id: str,
        input: Optional[Any] = None,
        *,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None,
        async_execution: Optional[bool] = None,
        execution_timeout_seconds: Optional[int] = None
    ) -> Union[WorkflowExecutionResult, AsyncExecutionResult]:
        """
        Execute a workflow with optional input data.
        If async_execution is True, returns immediately with a run ID.

        File objects in input will be automatically detected and converted to base64.

        Args:
            workflow_id: The ID of the workflow to execute
            input: Input data to pass to the workflow, sent nested under the request
                   body's 'input' field. A dict becomes the workflow input as-is; any
                   other value (string, number, bool, list) is wrapped as
                   {'input': value}. File-like objects within it are automatically
                   converted to base64.
            timeout: Timeout in seconds (default: 30.0)
            stream: Enable streaming responses (default: None)
            selected_outputs: Block outputs to stream (e.g., ["agent1.content"])
            async_execution: Execute asynchronously (default: None)
            execution_timeout_seconds: Server-side async execution cap in seconds (1-604800)

        Returns:
            WorkflowExecutionResult or AsyncExecutionResult object

        Raises:
            SimStudioError: If the workflow execution fails
        """
        url = f"{self.base_url}/api/v2/workflows/{workflow_id}/execute"

        if execution_timeout_seconds is not None:
            if not async_execution:
                raise SimStudioError(
                    'execution_timeout_seconds is supported only for async executions',
                    'INVALID_EXECUTION_TIMEOUT'
                )
            if (
                isinstance(execution_timeout_seconds, bool)
                or not isinstance(execution_timeout_seconds, int)
                or execution_timeout_seconds < 1
                or execution_timeout_seconds > MAX_EXECUTION_TIMEOUT_SECONDS
            ):
                raise SimStudioError(
                    f'execution_timeout_seconds must be an integer between 1 and {MAX_EXECUTION_TIMEOUT_SECONDS}',
                    'INVALID_EXECUTION_TIMEOUT'
                )

        headers = self._session.headers.copy()

        try:
            workflow_input = {}
            if input is not None:
                if isinstance(input, dict):
                    workflow_input = input.copy()
                else:
                    workflow_input = {'input': input}

            workflow_input = self._convert_files_to_base64(workflow_input)
            body = {'input': workflow_input}

            if stream is not None:
                body['stream'] = stream
            if selected_outputs is not None:
                body['selectedOutputs'] = selected_outputs
            if async_execution is not None:
                body['async'] = async_execution
            if execution_timeout_seconds is not None:
                body['executionTimeoutSeconds'] = execution_timeout_seconds

            response = self._session.post(
                url,
                json=body,
                headers=headers,
                timeout=timeout
            )

            # Update rate limit info
            self._update_rate_limit_info(response)

            # Handle rate limiting
            if response.status_code == 429:
                retry_after = self._rate_limit_info.retry_after if self._rate_limit_info else 1000
                raise SimStudioError(
                    f'Rate limit exceeded. Retry after {retry_after}ms',
                    'RATE_LIMIT_EXCEEDED',
                    429
                )

            if not response.ok:
                try:
                    error_data = response.json()
                    error = error_data.get('error', {})
                    error_message = error.get('message', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise SimStudioError(error_message, error_code, response.status_code)

            result = response.json()
            if 'data' not in result:
                raise SimStudioError('Invalid v2 workflow execution response', 'EXECUTION_ERROR')
            result_data = result['data']

            if response.status_code == 202:
                if 'runId' not in result_data or 'statusUrl' not in result_data:
                    raise SimStudioError('Invalid v2 async execution response', 'EXECUTION_ERROR')
                return AsyncExecutionResult(
                    success=True,
                    run_id=result_data['runId'],
                    status_url=result_data['statusUrl'],
                    message='Workflow execution queued',
                    async_execution=True
                )

            execution_error = result_data.get('error')
            status = result_data.get('status')
            return WorkflowExecutionResult(
                success=status in _SUCCESSFUL_RUN_STATUSES,
                output=result_data.get('output'),
                error=execution_error.get('message') if execution_error else None,
                metadata={
                    'duration': result_data.get('durationMs'),
                    'runId': result_data['runId'],
                    'startTime': result_data.get('startedAt'),
                    'endTime': result_data.get('endedAt')
                },
                total_duration=result_data.get('durationMs'),
                status=status
            )

        except requests.Timeout:
            raise SimStudioError(f'Workflow execution timed out after {timeout} seconds', 'TIMEOUT')
        except requests.RequestException as e:
            raise SimStudioError(f'Failed to execute workflow: {str(e)}', 'EXECUTION_ERROR')
    
    def get_workflow_status(self, workflow_id: str) -> WorkflowStatus:
        """
        Get the status of a workflow (deployment status, etc.).
        
        Args:
            workflow_id: The ID of the workflow
            
        Returns:
            WorkflowStatus object containing the workflow status
            
        Raises:
            SimStudioError: If getting the status fails
        """
        url = f"{self.base_url}/api/workflows/{workflow_id}/status"
        
        try:
            response = self._session.get(url)
            
            if not response.ok:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None
                
                raise SimStudioError(error_message, error_code, response.status_code)
            
            status_data = response.json()
            
            return WorkflowStatus(
                is_deployed=status_data.get('isDeployed', False),
                deployed_at=status_data.get('deployedAt'),
                needs_redeployment=status_data.get('needsRedeployment', False)
            )
            
        except requests.RequestException as e:
            raise SimStudioError(f'Failed to get workflow status: {str(e)}', 'STATUS_ERROR')
    
    def validate_workflow(self, workflow_id: str) -> bool:
        """
        Validate that a workflow is ready for execution.
        
        Args:
            workflow_id: The ID of the workflow
            
        Returns:
            True if the workflow is deployed and ready, False otherwise
        """
        try:
            status = self.get_workflow_status(workflow_id)
            return status.is_deployed
        except SimStudioError:
            return False
    
    def execute_workflow_sync(
        self,
        workflow_id: str,
        input: Optional[Any] = None,
        *,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None
    ) -> WorkflowExecutionResult:
        """
        Execute a workflow synchronously (ensures non-async mode).

        Args:
            workflow_id: The ID of the workflow to execute
            input: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout for the initial request in seconds
            stream: Enable streaming responses (default: None)
            selected_outputs: Block outputs to stream (e.g., ["agent1.content"])

        Returns:
            WorkflowExecutionResult object containing the execution result

        Raises:
            SimStudioError: If the workflow execution fails
        """
        return self.execute_workflow(
            workflow_id,
            input,
            timeout=timeout,
            stream=stream,
            selected_outputs=selected_outputs,
            async_execution=False
        )
    
    def set_api_key(self, api_key: str) -> None:
        """
        Update the API key.
        
        Args:
            api_key: New API key
        """
        self.api_key = api_key
        self._session.headers.update({'X-API-Key': api_key})
    
    def set_base_url(self, base_url: str) -> None:
        """
        Update the base URL.
        
        Args:
            base_url: New base URL
        """
        self.base_url = base_url.rstrip('/')
    
    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._session.close()

    def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """
        Get the status of a legacy async job.

        Args:
            job_id: The job ID returned from legacy async execution

        Returns:
            Dictionary containing the job status

        Raises:
            SimStudioError: If getting the status fails
        """
        url = f"{self.base_url}/api/jobs/{job_id}"

        try:
            response = self._session.get(url)

            self._update_rate_limit_info(response)

            if not response.ok:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise SimStudioError(error_message, error_code, response.status_code)

            return response.json()

        except requests.RequestException as e:
            raise SimStudioError(f'Failed to get job status: {str(e)}', 'STATUS_ERROR')

    def get_workflow_run(
        self,
        workflow_id: str,
        run_id: str,
        *,
        include_output: Optional[bool] = None,
        selected_outputs: Optional[list] = None
    ) -> Dict[str, Any]:
        """
        Get a workflow run's current status and optional outputs from the v2 API.

        Args:
            workflow_id: The workflow ID
            run_id: The run ID returned from async execution
            include_output: Include the final output for completed executions
            selected_outputs: Block output selectors to include

        Returns:
            Dictionary containing the run status

        Raises:
            SimStudioError: If getting the status fails
        """
        url = f"{self.base_url}/api/v2/workflows/{workflow_id}/runs/{run_id}"
        params = {}
        if include_output is not None:
            params['includeOutput'] = str(include_output).lower()
        if selected_outputs:
            params['selectedOutputs'] = ','.join(selected_outputs)

        try:
            response = self._session.get(url, params=params or None)

            self._update_rate_limit_info(response)

            if not response.ok:
                try:
                    error_data = response.json()
                    error = error_data.get('error', {})
                    error_message = error.get('message', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise SimStudioError(error_message, error_code, response.status_code)

            result = response.json()
            if 'data' not in result:
                raise SimStudioError('Invalid v2 workflow run response', 'STATUS_ERROR')
            return result['data']

        except requests.RequestException as e:
            raise SimStudioError(f'Failed to get workflow run: {str(e)}', 'STATUS_ERROR')

    def execute_with_retry(
        self,
        workflow_id: str,
        input: Optional[Any] = None,
        *,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None,
        async_execution: Optional[bool] = None,
        execution_timeout_seconds: Optional[int] = None,
        max_retries: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_multiplier: float = 2.0
    ) -> Union[WorkflowExecutionResult, AsyncExecutionResult]:
        """
        Execute workflow with automatic retry on rate limit.

        Args:
            workflow_id: The ID of the workflow to execute
            input: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout in seconds
            stream: Enable streaming responses
            selected_outputs: Block outputs to stream
            async_execution: Execute asynchronously
            execution_timeout_seconds: Server-side async execution cap in seconds (1-604800)
            max_retries: Maximum number of retries (default: 3)
            initial_delay: Initial delay in seconds (default: 1.0)
            max_delay: Maximum delay in seconds (default: 30.0)
            backoff_multiplier: Backoff multiplier (default: 2.0)

        Returns:
            WorkflowExecutionResult or AsyncExecutionResult object

        Raises:
            SimStudioError: If max retries exceeded or other error occurs
        """
        last_error = None
        delay = initial_delay

        for attempt in range(max_retries + 1):
            try:
                return self.execute_workflow(
                    workflow_id,
                    input,
                    timeout=timeout,
                    stream=stream,
                    selected_outputs=selected_outputs,
                    async_execution=async_execution,
                    execution_timeout_seconds=execution_timeout_seconds,
                )
            except SimStudioError as e:
                if e.code != 'RATE_LIMIT_EXCEEDED':
                    raise

                last_error = e

                # Don't retry after last attempt
                if attempt == max_retries:
                    break

                # Use retry-after if provided, otherwise use exponential backoff
                wait_time = (
                    self._rate_limit_info.retry_after / 1000
                    if self._rate_limit_info and self._rate_limit_info.retry_after
                    else min(delay, max_delay)
                )

                # Add jitter (±25%)
                jitter = wait_time * (0.75 + random.random() * 0.5)

                time.sleep(jitter)

                # Exponential backoff for next attempt
                delay *= backoff_multiplier

        raise last_error or SimStudioError('Max retries exceeded', 'MAX_RETRIES_EXCEEDED')

    def get_rate_limit_info(self) -> Optional[RateLimitInfo]:
        """
        Get current rate limit information.

        Returns:
            RateLimitInfo object or None if no rate limit info available
        """
        return self._rate_limit_info

    def _update_rate_limit_info(self, response: requests.Response) -> None:
        """
        Update rate limit info from response headers.

        Args:
            response: The response object to extract headers from
        """
        limit = response.headers.get('x-ratelimit-limit')
        remaining = response.headers.get('x-ratelimit-remaining')
        reset = response.headers.get('x-ratelimit-reset')
        retry_after = response.headers.get('retry-after')

        if limit or remaining or reset:
            self._rate_limit_info = RateLimitInfo(
                limit=int(limit) if limit else 0,
                remaining=int(remaining) if remaining else 0,
                reset=_parse_reset_header(reset) if reset else 0,
                retry_after=int(retry_after) * 1000 if retry_after else None
            )

    def get_usage_limits(self) -> UsageLimits:
        """
        Get current usage limits and quota information.

        Returns:
            UsageLimits object containing usage and quota data

        Raises:
            SimStudioError: If getting usage limits fails
        """
        url = f"{self.base_url}/api/users/me/usage-limits"

        try:
            response = self._session.get(url)

            self._update_rate_limit_info(response)

            if not response.ok:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise SimStudioError(error_message, error_code, response.status_code)

            data = response.json()

            return UsageLimits(
                success=data.get('success', True),
                rate_limit=data.get('rateLimit', {}),
                usage=data.get('usage', {})
            )

        except requests.RequestException as e:
            raise SimStudioError(f'Failed to get usage limits: {str(e)}', 'USAGE_ERROR')

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


# For backward compatibility
Client = SimStudioClient
