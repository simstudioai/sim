"""
Sim Studio SDK for Python

Official Python SDK for Sim Studio, allowing you to execute workflows programmatically.
"""

from typing import Any, Dict, Optional
from dataclasses import dataclass

import requests


__version__ = "0.1.0"
__all__ = ["SimStudioClient", "SimStudioError", "WorkflowExecutionResult", "WorkflowStatus"]


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
    is_published: bool = False
    needs_redeployment: bool = False


class SimStudioError(Exception):
    """Exception raised for Sim Studio API errors."""
    
    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


class SimStudioClient:
    """
    Sim Studio API client for executing workflows programmatically.
    
    Args:
        api_key: Your Sim Studio API key
        base_url: Base URL for the Sim Studio API (defaults to https://simstudio.ai)
    """
    
    def __init__(self, api_key: str, base_url: str = "https://simstudio.ai"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self._session = requests.Session()
        self._session.headers.update({
            'X-API-Key': self.api_key,
            'Content-Type': 'application/json',
        })
    
    def execute_workflow(
        self, 
        workflow_id: str, 
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0
    ) -> WorkflowExecutionResult:
        """
        Execute a workflow with optional input data.
        
        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow
            timeout: Timeout in seconds (default: 30.0)
            
        Returns:
            WorkflowExecutionResult object containing the execution result
            
        Raises:
            SimStudioError: If the workflow execution fails
        """
        url = f"{self.base_url}/api/workflows/{workflow_id}/execute"
        
        try:
            response = self._session.post(
                url,
                json=input_data or {},
                timeout=timeout
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
                is_published=status_data.get('isPublished', False),
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
        timeout: float = 30.0
    ) -> WorkflowExecutionResult:
        """
        Execute a workflow and poll for completion (useful for long-running workflows).
        
        Note: Currently, the API is synchronous, so this method just calls execute_workflow.
        In the future, if async execution is added, this method can be enhanced.
        
        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow
            timeout: Timeout for the initial request in seconds
            
        Returns:
            WorkflowExecutionResult object containing the execution result
            
        Raises:
            SimStudioError: If the workflow execution fails
        """
        # For now, the API is synchronous, so we just execute directly
        # In the future, if async execution is added, this method can be enhanced
        return self.execute_workflow(workflow_id, input_data, timeout)
    
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
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


# For backward compatibility
Client = SimStudioClient 