"""
Tests for the Sim Python SDK
"""

import pytest
from unittest.mock import Mock, patch
from simstudio import SimStudioClient, SimStudioError, WorkflowExecutionResult, WorkflowStatus


def v2_execution_response(output=None, status="completed", error=None):
    return {
        "data": {
            "runId": "execution-123",
            "workflowId": "workflow-id",
            "status": status,
            "output": {} if output is None else output,
            "error": error,
            "startedAt": "2026-08-11T12:00:00.000Z",
            "endedAt": "2026-08-11T12:00:00.010Z",
            "durationMs": 10
        }
    }


def mock_execution_post(mock_post, status="completed", error=None, headers=None):
    """Wire a mocked 200 v2 execution response with the given terminal status."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response(status=status, error=error)
    mock_response.headers.get.side_effect = lambda h: (headers or {}).get(h)
    mock_post.return_value = mock_response
    return mock_response


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
        needs_redeployment=False
    )
    assert status.is_deployed is True
    assert status.deployed_at == "2023-01-01T00:00:00Z"
    assert status.needs_redeployment is False


@patch('simstudio.requests.Session.close')
def test_context_manager(mock_close):
    """Test SimStudioClient as context manager."""
    with SimStudioClient(api_key="test-api-key") as client:
        assert client.api_key == "test-api-key"
    mock_close.assert_called_once()


@patch('simstudio.requests.Session.post')
def test_async_execution_returns_run_id(mock_post):
    """Test async execution returns AsyncExecutionResult."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 202
    mock_response.json.return_value = {
        "data": {
            "runId": "execution-123",
            "statusUrl": "https://sim.ai/api/v2/workflows/workflow-id/runs/execution-123"
        }
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow(
        "workflow-id",
        {"message": "Hello"},
        async_execution=True
    )

    assert result.success is True
    assert result.run_id == "execution-123"
    assert result.status_url == "https://sim.ai/api/v2/workflows/workflow-id/runs/execution-123"
    assert result.async_execution is True

    call_args = mock_post.call_args
    assert call_args.args[0] == "https://sim.ai/api/v2/workflows/workflow-id/execute"
    assert "X-Execution-Mode" not in call_args.kwargs["headers"]
    assert call_args.kwargs["json"] == {
        "input": {"message": "Hello"},
        "async": True
    }


@patch('simstudio.requests.Session.post')
def test_sync_execution_returns_result(mock_post):
    """Test sync execution returns WorkflowExecutionResult."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response({"result": "completed"})
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow(
        "workflow-id",
        {"message": "Hello"},
        async_execution=False
    )

    assert result.success is True
    assert result.status == "completed"
    assert result.output == {"result": "completed"}
    assert result.metadata == {
        "duration": 10,
        "runId": "execution-123",
        "startTime": "2026-08-11T12:00:00.000Z",
        "endTime": "2026-08-11T12:00:00.010Z"
    }
    assert not hasattr(result, 'task_id')


@patch('simstudio.requests.Session.post')
def test_sync_execution_cancelled_is_not_success(mock_post):
    """A run cancelled out of band is not a success, matching the TypeScript SDK."""
    mock_execution_post(mock_post, status="cancelled")

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow("workflow-id", {})

    assert result.success is False
    assert result.status == "cancelled"


@patch('simstudio.requests.Session.post')
def test_sync_execution_failed_is_not_success(mock_post):
    """A failed run is not a success and surfaces the server's error message."""
    mock_execution_post(
        mock_post,
        status="failed",
        error={"code": "BLOCK_EXECUTION_FAILED", "message": "Invalid credentials"}
    )

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow("workflow-id", {})

    assert result.success is False
    assert result.status == "failed"
    assert result.error == "Invalid credentials"


@patch('simstudio.requests.Session.post')
def test_sync_execution_paused_is_success(mock_post):
    """A paused run is still a success -- it is waiting, not broken."""
    mock_execution_post(mock_post, status="paused")

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow("workflow-id", {})

    assert result.success is True
    assert result.status == "paused"


@patch('simstudio.requests.Session.post')
def test_async_header_not_set_when_false(mock_post):
    """Test X-Execution-Mode header is not set when async_execution is None."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", {"message": "Hello"})

    call_args = mock_post.call_args
    assert "X-Execution-Mode" not in call_args[1]["headers"]


@patch('simstudio.requests.Session.post')
def test_async_execution_timeout_body(mock_post):
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 202
    mock_response.json.return_value = {
        "data": {
            "runId": "execution-123",
            "statusUrl": "/api/v2/workflows/workflow-id/runs/execution-123",
        }
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow(
        "workflow-id",
        {},
        async_execution=True,
        execution_timeout_seconds=90,
    )

    body = mock_post.call_args[1]["json"]
    assert body["executionTimeoutSeconds"] == 90


def test_sync_execution_rejects_execution_timeout():
    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.execute_workflow("workflow-id", {}, execution_timeout_seconds=90)

    assert exc_info.value.code == "INVALID_EXECUTION_TIMEOUT"


def test_execution_timeout_rejects_more_than_seven_days():
    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.execute_workflow(
            "workflow-id",
            {},
            async_execution=True,
            execution_timeout_seconds=604_801,
        )

    assert exc_info.value.code == "INVALID_EXECUTION_TIMEOUT"


def test_execute_with_retry_forwards_execution_timeout():
    client = SimStudioClient(api_key="test-api-key")
    expected = Mock()

    with patch.object(client, "execute_workflow", return_value=expected) as execute_workflow:
        result = client.execute_with_retry(
            "workflow-id",
            {"message": "hello"},
            async_execution=True,
            execution_timeout_seconds=90,
        )

    assert result is expected
    execute_workflow.assert_called_once_with(
        "workflow-id",
        {"message": "hello"},
        timeout=30.0,
        stream=None,
        selected_outputs=None,
        async_execution=True,
        execution_timeout_seconds=90,
    )


@patch('simstudio.requests.Session.get')
def test_get_job_status_success(mock_get):
    """Test getting legacy job status."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.json.return_value = {
        "success": True,
        "taskId": "task-123",
        "status": "completed",
        "metadata": {"duration": 60000},
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
    """Test legacy job not found error."""
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


@patch('simstudio.requests.Session.get')
def test_get_workflow_run_success(mock_get):
    mock_response = Mock()
    mock_response.ok = True
    mock_response.json.return_value = {
        "data": {
            "runId": "execution-123",
            "workflowId": "workflow-123",
            "status": "completed",
            "output": {"result": "done"}
        }
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key", base_url="https://test.sim.ai")
    result = client.get_workflow_run(
        "workflow-123",
        "execution-123",
        include_output=True,
        selected_outputs=["agent.content"]
    )

    assert result["runId"] == "execution-123"
    assert result["status"] == "completed"
    assert result["output"]["result"] == "done"
    mock_get.assert_called_once_with(
        "https://test.sim.ai/api/v2/workflows/workflow-123/runs/execution-123",
        params={"includeOutput": "true", "selectedOutputs": "agent.content"}
    )


@patch('simstudio.requests.Session.get')
def test_get_workflow_run_not_found(mock_get):
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 404
    mock_response.reason = "Not Found"
    mock_response.json.return_value = {
        "error": {
            "code": "NOT_FOUND",
            "message": "Run not found"
        }
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.get_workflow_run("workflow-123", "invalid-run")
    assert "Run not found" in str(exc_info.value)


@patch('simstudio.requests.Session.post')
@patch('simstudio.time.sleep')
def test_execute_with_retry_success_first_attempt(mock_sleep, mock_post):
    """Test retry succeeds on first attempt."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response({"result": "success"})
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_with_retry("workflow-id", {"message": "test"})

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
    success_response.json.return_value = v2_execution_response({"result": "success"})
    success_response.headers.get.return_value = None

    mock_post.side_effect = [rate_limit_response, success_response]

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_with_retry(
        "workflow-id",
        {"message": "test"},
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
            {"message": "test"},
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
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Server error"
        }
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")

    with pytest.raises(SimStudioError) as exc_info:
        client.execute_with_retry("workflow-id", {"message": "test"})

    assert "Server error" in str(exc_info.value)
    assert mock_post.call_count == 1  # No retries


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
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.side_effect = lambda h: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '95',
        'x-ratelimit-reset': '1704067200'
    }.get(h)
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", {})

    info = client.get_rate_limit_info()
    assert info is not None
    assert info.limit == 100
    assert info.remaining == 95
    assert info.reset == 1704067200


@patch('simstudio.requests.Session.post')
def test_rate_limit_reset_accepts_iso_timestamp(mock_post):
    """The v2 API sends X-RateLimit-Reset as an ISO 8601 timestamp, not an epoch int."""
    mock_execution_post(mock_post, headers={
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '2024-01-01T00:00:00.000Z'
    })

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow("workflow-id", {})

    assert result.success is True
    info = client.get_rate_limit_info()
    assert info is not None
    assert info.reset == 1704067200000


@pytest.mark.parametrize('reset_header', ['not-a-timestamp', '²'])
@patch('simstudio.requests.Session.post')
def test_rate_limit_reset_tolerates_unparseable_value(mock_post, reset_header):
    """
    An unrecognised quota hint reports 0 rather than failing the execution.

    '²' covers the digit-like characters str.isdigit() accepts but int()
    rejects.
    """
    mock_execution_post(mock_post, headers={
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': reset_header
    })

    client = SimStudioClient(api_key="test-api-key")
    result = client.execute_workflow("workflow-id", {})

    assert result.success is True
    info = client.get_rate_limit_info()
    assert info is not None
    assert info.reset == 0


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


@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_stream_and_selected_outputs(mock_post):
    """Test execution with stream and selectedOutputs parameters."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow(
        "workflow-id",
        {"message": "test"},
        stream=True,
        selected_outputs=["agent1.content", "agent2.content"]
    )

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["input"] == {"message": "test"}
    assert request_body["stream"] is True
    assert request_body["selectedOutputs"] == ["agent1.content", "agent2.content"]


# Tests for primitive and list inputs
@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_string_input(mock_post):
    """Test execution with primitive string input wraps in input field."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", "NVDA")

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["input"] == {"input": "NVDA"}
    assert "0" not in request_body  # Should not spread string characters


@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_number_input(mock_post):
    """Test execution with primitive number input wraps in input field."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", 42)

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["input"] == {"input": 42}


@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_list_input(mock_post):
    """Test execution with list input wraps in input field."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", ["NVDA", "AAPL", "GOOG"])

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["input"] == {"input": ["NVDA", "AAPL", "GOOG"]}
    assert "0" not in request_body  # Should not spread list


@patch('simstudio.requests.Session.post')
def test_execute_workflow_with_dict_input_uses_v2_input_field(mock_post):
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = v2_execution_response()
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = SimStudioClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", {"ticker": "NVDA", "quantity": 100})

    call_args = mock_post.call_args
    request_body = call_args[1]["json"]

    assert request_body["input"] == {"ticker": "NVDA", "quantity": 100}
