"""
Sim SDK for Python

Official Python SDK for Sim, allowing you to execute workflows programmatically.
"""

from typing import Any, Dict, Optional, Union
from dataclasses import dataclass
import time
import random
import os

import requests


__version__ = "0.1.0"
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
    """Result of a workflow execution."""
    success: bool
    output: Optional[Any] = None
    error: Optional[str] = None
    logs: Optional[list] = None
    metadata: Optional[Dict[str, Any]] = None
    trace_spans: Optional[list] = None
    total_duration: Optional[float] = None


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
    task_id: str
    status: str  # 'queued'
    created_at: str
    links: Dict[str, str]


@dataclass
class RateLimitInfo:
    """Rate limit information from API response headers."""
    limit: int
    remaining: int
    reset: int
    retry_after: Optional[int] = None


@dataclass
class RateLimitStatus:
    """Rate limit status for sync/async requests."""
    is_limited: bool
    limit: int
    remaining: int
    reset_at: str


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
        import io

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
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None,
        async_execution: Optional[bool] = None
    ) -> Union[WorkflowExecutionResult, AsyncExecutionResult]:
        """
        Execute a workflow with optional input data.
        If async_execution is True, returns immediately with a task ID.

        File objects in input_data will be automatically detected and converted to base64.

        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout in seconds (default: 30.0)
            stream: Enable streaming responses (default: None)
            selected_outputs: Block outputs to stream (e.g., ["agent1.content"])
            async_execution: Execute asynchronously (default: None)

        Returns:
            WorkflowExecutionResult or AsyncExecutionResult object

        Raises:
            SimStudioError: If the workflow execution fails
        """
        url = f"{self.base_url}/api/workflows/{workflow_id}/execute"

        # Build headers - async execution uses X-Execution-Mode header
        headers = self._session.headers.copy()
        if async_execution:
            headers['X-Execution-Mode'] = 'async'

        try:
            # Build JSON body - spread input at root level, then add API control parameters
            body = input_data.copy() if input_data is not None else {}

            # Convert any file objects in the input to base64 format
            body = self._convert_files_to_base64(body)

            if stream is not None:
                body['stream'] = stream
            if selected_outputs is not None:
                body['selectedOutputs'] = selected_outputs

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
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise SimStudioError(error_message, error_code, response.status_code)

            result_data = response.json()

            # Check if this is an async execution response (202 status)
            if response.status_code == 202 and 'taskId' in result_data:
                return AsyncExecutionResult(
                    success=result_data.get('success', True),
                    task_id=result_data['taskId'],
                    status=result_data.get('status', 'queued'),
                    created_at=result_data.get('createdAt', ''),
                    links=result_data.get('links', {})
                )

            return WorkflowExecutionResult(
                success=result_data['success'],
                output=result_data.get('output'),
                error=result_data.get('error'),
                logs=result_data.get('logs'),
                metadata=result_data.get('metadata'),
                trace_spans=result_data.get('traceSpans'),
                total_duration=result_data.get('totalDuration')
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
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None
    ) -> WorkflowExecutionResult:
        """
        Execute a workflow and poll for completion (useful for long-running workflows).

        Note: Currently, the API is synchronous, so this method just calls execute_workflow.
        In the future, if async execution is added, this method can be enhanced.

        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout for the initial request in seconds
            stream: Enable streaming responses (default: None)
            selected_outputs: Block outputs to stream (e.g., ["agent1.content"])

        Returns:
            WorkflowExecutionResult object containing the execution result

        Raises:
            SimStudioError: If the workflow execution fails
        """
        # For now, the API is synchronous, so we just execute directly
        # In the future, if async execution is added, this method can be enhanced
        return self.execute_workflow(workflow_id, input_data, timeout, stream, selected_outputs)
    
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

    def get_job_status(self, task_id: str) -> Dict[str, Any]:
        """
        Get the status of an async job.

        Args:
            task_id: The task ID returned from async execution

        Returns:
            Dictionary containing the job status

        Raises:
            SimStudioError: If getting the status fails
        """
        url = f"{self.base_url}/api/jobs/{task_id}"

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

    def execute_with_retry(
        self,
        workflow_id: str,
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0,
        stream: Optional[bool] = None,
        selected_outputs: Optional[list] = None,
        async_execution: Optional[bool] = None,
        max_retries: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_multiplier: float = 2.0
    ) -> Union[WorkflowExecutionResult, AsyncExecutionResult]:
        """
        Execute workflow with automatic retry on rate limit.

        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout in seconds
            stream: Enable streaming responses
            selected_outputs: Block outputs to stream
            async_execution: Execute asynchronously
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
                    input_data,
                    timeout,
                    stream,
                    selected_outputs,
                    async_execution
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
                reset=int(reset) if reset else 0,
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