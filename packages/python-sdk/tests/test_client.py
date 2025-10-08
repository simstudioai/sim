"""
Tests for the Sim Python SDK
"""

import pytest
from unittest.mock import Mock, patch
from simstudio import SimStudioClient, SimStudioError, WorkflowExecutionResult, WorkflowStatus


def test_simstudio_client_initialization():
    """Test SimStudioClient initialization."""
    client = SimStudioClient(api_key="test-api-key", base_url="https://test.sim.ai")
    assert client.api_key == "test-api-key"
    assert client.base_url == "https://test.sim.ai"


def test_simstudio_client_default_base_url():
    """Test SimStudioClient with default base URL."""
    client = SimStudioClient(api_key="test-api-key")
    assert client.api_key == "test-api-key"
    assert client.base_url == "https://sim.ai"


def test_set_api_key():
    """Test setting a new API key."""
    client = SimStudioClient(api_key="test-api-key")
    client.set_api_key("new-api-key")
    assert client.api_key == "new-api-key"


def test_set_base_url():
    """Test setting a new base URL."""
    client = SimStudioClient(api_key="test-api-key")
    client.set_base_url("https://new.sim.ai/")
    assert client.base_url == "https://new.sim.ai"


def test_set_base_url_strips_trailing_slash():
    """Test that base URL strips trailing slash."""
    client = SimStudioClient(api_key="test-api-key")
    client.set_base_url("https://test.sim.ai/")
    assert client.base_url == "https://test.sim.ai"


@patch('simstudio.requests.Session.get')
def test_validate_workflow_returns_false_on_error(mock_get):
    """Test that validate_workflow returns False when request fails."""
    mock_get.side_effect = SimStudioError("Network error")
    
    client = SimStudioClient(api_key="test-api-key")
    result = client.validate_workflow("test-workflow-id")
    
    assert result is False
    mock_get.assert_called_once_with("https://sim.ai/api/workflows/test-workflow-id/status")


def test_simstudio_error():
    """Test SimStudioError creation."""
    error = SimStudioError("Test error", "TEST_CODE", 400)
    assert str(error) == "Test error"
    assert error.code == "TEST_CODE"
    assert error.status == 400


def test_workflow_execution_result():
    """Test WorkflowExecutionResult data class."""
    result = WorkflowExecutionResult(
        success=True,
        output={"data": "test"},
        metadata={"duration": 1000}
    )
    assert result.success is True
    assert result.output == {"data": "test"}
    assert result.metadata == {"duration": 1000}


def test_workflow_status():
    """Test WorkflowStatus data class."""
    status = WorkflowStatus(
        is_deployed=True,
        deployed_at="2023-01-01T00:00:00Z",
        is_published=False,
        needs_redeployment=False
    )
    assert status.is_deployed is True
    assert status.deployed_at == "2023-01-01T00:00:00Z"
    assert status.is_published is False
    assert status.needs_redeployment is False


@patch('simstudio.requests.Session.close')
def test_context_manager(mock_close):
    """Test SimStudioClient as context manager."""
    with SimStudioClient(api_key="test-api-key") as client:
        assert client.api_key == "test-api-key"
    # Should close without error
    mock_close.assert_called_once()


# Tests for async execution
@patch('simstudio.requests.Session.post')
def test_async_execution_returns_task_id(mock_post):
    """Test async execution returns AsyncExecutionResult."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 202
    mock_response.json.return_value = {
        "success": True,
        "taskId": "task-123",
        "status": "queued",
        "createdAt": "2024-01-01T00:00:00Z",
        "links": {"status": "/api/jobs/task-123"}
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow(
        "workflow-id",
        input_data={"message": "Hello"},
        async_execution=True
    )

    assert result.success is True
    assert result.task_id == "task-123"
    assert result.status == "queued"
    assert result.links["status"] == "/api/jobs/task-123"

    # Verify X-Execution-Mode header was set
    call_args = mock_post.call_args
    assert call_args[1]["headers"]["X-Execution-Mode"] == "async"


@patch('simstudio.requests.Session.post')
def test_sync_execution_returns_result(mock_post):
    """Test sync execution returns WorkflowExecutionResult."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "output": {"result": "completed"},
        "logs": []
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow(
        "workflow-id",
        input_data={"message": "Hello"},
        async_execution=False
    )

    assert result.success is True
    assert result.output == {"result": "completed"}
    assert not hasattr(result, 'task_id')


@patch('simstudio.requests.Session.post')
def test_async_header_not_set_when_false(mock_post):
    """Test X-Execution-Mode header is not set when async_execution is None."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "output": {}}
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", input_data={"message": "Hello"})

    call_args = mock_post.call_args
    assert "X-Execution-Mode" not in call_args[1]["headers"]


# Tests for job status
@patch('simstudio.requests.Session.get')
def test_get_job_status_success(mock_get):
    """Test getting job status."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.json.return_value = {
        "success": True,
        "taskId": "task-123",
        "status": "completed",
        "metadata": {
            "startedAt": "2024-01-01T00:00:00Z",
            "completedAt": "2024-01-01T00:01:00Z",
            "duration": 60000
        },
        "output": {"result": "done"}
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key", base_url="https://test.sim.ai")
    result = client.get_job_status("task-123")

    assert result["taskId"] == "task-123"
    assert result["status"] == "completed"
    assert result["output"]["result"] == "done"
    mock_get.assert_called_once_with("https://test.sim.ai/api/jobs/task-123")


@patch('simstudio.requests.Session.get')
def test_get_job_status_not_found(mock_get):
    """Test job not found error."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 404
    mock_response.reason = "Not Found"
    mock_response.json.return_value = {
        "error": "Job not found",
        "code": "JOB_NOT_FOUND"
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.get_job_status("invalid-task")
    assert "Job not found" in str(exc_info.value)


# Tests for retry with rate limiting
@patch('simstudio.requests.Session.post')
@patch('simstudio.time.sleep')
def test_execute_with_retry_success_first_attempt(mock_sleep, mock_post):
    """Test retry succeeds on first attempt."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "output": {"result": "success"}
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_with_retry("workflow-id", input_data={"message": "test"})

    assert result.success is True
    assert mock_post.call_count == 1
    assert mock_sleep.call_count == 0


@patch('simstudio.requests.Session.post')
@patch('simstudio.time.sleep')
def test_execute_with_retry_retries_on_rate_limit(mock_sleep, mock_post):
    """Test retry retries on rate limit error."""
    rate_limit_response = Mock()
    rate_limit_response.ok = False
    rate_limit_response.status_code = 429
    rate_limit_response.json.return_value = {
        "error": "Rate limit exceeded",
        "code": "RATE_LIMIT_EXCEEDED"
    }
    import time
    rate_limit_response.headers.get.side_effect = lambda h: {
        'retry-after': '1',
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': str(int(time.time()) + 60)
    }.get(h)

    success_response = Mock()
    success_response.ok = True
    success_response.status_code = 200
    success_response.json.return_value = {
        "success": True,
        "output": {"result": "success"}
    }
    success_response.headers.get.return_value = None

    mock_post.side_effect = [rate_limit_response, success_response]

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_with_retry(
        "workflow-id",
        input_data={"message": "test"},
        max_retries=3,
        initial_delay=0.01
    )

    assert result.success is True
    assert mock_post.call_count == 2
    assert mock_sleep.call_count == 1


@patch('simstudio.requests.Session.post')
@patch('simstudio.time.sleep')
def test_execute_with_retry_max_retries_exceeded(mock_sleep, mock_post):
    """Test retry throws after max retries."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 429
    mock_response.json.return_value = {
        "error": "Rate limit exceeded",
        "code": "RATE_LIMIT_EXCEEDED"
    }
    mock_response.headers.get.side_effect = lambda h: '1' if h == 'retry-after' else None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.execute_with_retry(
            "workflow-id",
            input_data={"message": "test"},
            max_retries=2,
            initial_delay=0.01
        )

    assert "Rate limit exceeded" in str(exc_info.value)
    assert mock_post.call_count == 3  # Initial + 2 retries


@patch('simstudio.requests.Session.post')
def test_execute_with_retry_no_retry_on_other_errors(mock_post):
    """Test retry does not retry on non-rate-limit errors."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 500
    mock_response.reason = "Internal Server Error"
    mock_response.json.return_value = {
        "error": "Server error",
        "code": "INTERNAL_ERROR"
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.execute_with_retry("workflow-id", input_data={"message": "test"})

    assert "Server error" in str(exc_info.value)
    assert mock_post.call_count == 1  # No retries


# Tests for rate limit info
def test_get_rate_limit_info_returns_none_initially():
    """Test rate limit info is None before any API calls."""
    client = SimStudioClient(api_key="test-api-key")
    info = client.get_rate_limit_info()
    assert info is None


@patch('simstudio.requests.Session.post')
def test_get_rate_limit_info_after_api_call(mock_post):
    """Test rate limit info is populated after API call."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "output": {}}
    mock_response.headers.get.side_effect = lambda h: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '95',
        'x-ratelimit-reset': '1704067200'
    }.get(h)
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", input_data={})

    info = client.get_rate_limit_info()
    assert info is not None
    assert info.limit == 100
    assert info.remaining == 95
    assert info.reset == 1704067200


# Tests for usage limits
@patch('simstudio.requests.Session.get')
def test_get_usage_limits_success(mock_get):
    """Test getting usage limits."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.json.return_value = {
        "success": True,
        "rateLimit": {
            "sync": {
                "isLimited": False,
                "limit": 100,
                "remaining": 95,
                "resetAt": "2024-01-01T01:00:00Z"
            },
            "async": {
                "isLimited": False,
                "limit": 50,
                "remaining": 48,
                "resetAt": "2024-01-01T01:00:00Z"
            },
            "authType": "api"
        },
        "usage": {
            "currentPeriodCost": 1.23,
            "limit": 100.0,
            "plan": "pro"
        }
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key", base_url="https://test.sim.ai")
    result = client.get_usage_limits()

    assert result.success is True
    assert result.rate_limit["sync"]["limit"] == 100
    assert result.rate_limit["async"]["limit"] == 50
    assert result.usage["currentPeriodCost"] == 1.23
    assert result.usage["plan"] == "pro"
    mock_get.assert_called_once_with("https://test.sim.ai/api/users/me/usage-limits")


@patch('simstudio.requests.Session.get')
def test_get_usage_limits_unauthorized(mock_get):
    """Test usage limits with invalid API key."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 401
    mock_response.reason = "Unauthorized"
    mock_response.json.return_value = {
        "error": "Invalid API key",
        "code": "UNAUTHORIZED"
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="invalid-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.get_usage_limits()
    assert "Invalid API key" in str(exc_info.value)


# Tests for streaming with selectedOutputs
@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_stream_and_selected_outputs(mock_post):
    """Test execution with stream and selectedOutputs parameters."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "output": {}}
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow(
        "workflow-id",
        input_data={"message": "test"},
        stream=True,
        selected_outputs=["agent1.content", "agent2.content"]
    )

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["message"] == "test"
    assert request_body["stream"] is True
    assert request_body["selectedOutputs"] == ["agent1.content", "agent2.content"] 