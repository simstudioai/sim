"""FastAPI server for workflow execution."""
import json
import logging
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from executor import WorkflowExecutor

# Configure logging
logging.basicConfig(
    level=os.environ.get('LOG_LEVEL', 'INFO').upper(),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('workflow-runner')

# Load environment variables
load_dotenv()
load_dotenv('.env.local')

# Configuration
MAX_REQUEST_SIZE = int(os.environ.get('MAX_REQUEST_SIZE', 10 * 1024 * 1024))  # 10MB default
RATE_LIMIT_REQUESTS = int(os.environ.get('RATE_LIMIT_REQUESTS', 60))  # per minute
RATE_LIMIT_WINDOW = int(os.environ.get('RATE_LIMIT_WINDOW', 60))  # seconds

app = FastAPI(title="Workflow Runner", version="1.0.0")

# Simple in-memory rate limiter (use Redis in production for distributed systems)
class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds

        # Clean old requests
        self.requests[client_id] = [
            t for t in self.requests[client_id] if t > window_start
        ]

        if len(self.requests[client_id]) >= self.max_requests:
            return False

        self.requests[client_id].append(now)
        return True

    def get_retry_after(self, client_id: str) -> int:
        if not self.requests[client_id]:
            return 0
        oldest = min(self.requests[client_id])
        return max(0, int(self.window_seconds - (time.time() - oldest)))

rate_limiter = RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)

@app.middleware("http")
async def rate_limit_and_size_middleware(request: Request, call_next):
    # Skip rate limiting for health checks
    if request.url.path in ('/health', '/ready'):
        return await call_next(request)

    # Check request size
    content_length = request.headers.get('content-length')
    if content_length and int(content_length) > MAX_REQUEST_SIZE:
        return JSONResponse(
            status_code=413,
            content={
                'error': 'Request too large',
                'max_size': MAX_REQUEST_SIZE,
                'received_size': int(content_length)
            }
        )

    # Rate limiting (use client IP as identifier)
    client_ip = request.client.host if request.client else 'unknown'
    if not rate_limiter.is_allowed(client_ip):
        retry_after = rate_limiter.get_retry_after(client_ip)
        return JSONResponse(
            status_code=429,
            content={
                'error': 'Rate limit exceeded',
                'retry_after': retry_after
            },
            headers={'Retry-After': str(retry_after)}
        )

    return await call_next(request)

# Server state
WORKFLOW_PATH = os.environ.get('WORKFLOW_PATH', 'workflow.json')
workflow_data: Optional[Dict[str, Any]] = None
startup_time: Optional[datetime] = None
startup_warnings: List[str] = []

def validate_environment() -> List[str]:
    """Validate required environment variables and return warnings."""
    warnings = []

    # Check for API keys - at least one should be present
    api_keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
    has_api_key = any(os.environ.get(k) for k in api_keys)
    if not has_api_key:
        warnings.append('No API key found. Set ANTHROPIC_API_KEY or another provider key.')

    # Check for masked/placeholder values
    for key in api_keys:
        value = os.environ.get(key, '')
        if value and ('your-key-here' in value.lower() or 'xxx' in value.lower()):
            warnings.append(f'{key} appears to be a placeholder value.')

    return warnings

@app.on_event("startup")
async def load_workflow():
    global workflow_data, startup_time, startup_warnings
    startup_time = datetime.now(timezone.utc)

    # Validate environment
    startup_warnings = validate_environment()
    for warning in startup_warnings:
        logger.warning(warning)

    # Load workflow
    workflow_path = Path(WORKFLOW_PATH)
    if workflow_path.exists():
        try:
            with open(workflow_path) as f:
                raw_data = json.load(f)
            # Handle both formats: {blocks, edges} and {state: {blocks, edges}}
            if 'state' in raw_data and 'blocks' in raw_data['state']:
                workflow_data = raw_data['state']
            else:
                workflow_data = raw_data
            logger.info(f'Loaded workflow from {WORKFLOW_PATH}')
        except json.JSONDecodeError as e:
            logger.error(f'Invalid JSON in workflow file: {e}')
            startup_warnings.append(f'Failed to parse workflow: {e}')
        except Exception as e:
            logger.error(f'Failed to load workflow: {e}')
            startup_warnings.append(f'Failed to load workflow: {e}')
    else:
        logger.warning(f'Workflow file not found: {WORKFLOW_PATH}')
        startup_warnings.append(f'Workflow file not found: {WORKFLOW_PATH}')

class ExecuteRequest(BaseModel):
    """Request model for workflow execution."""
    class Config:
        extra = 'allow'

@app.get("/health")
async def health():
    """Health check endpoint with detailed status."""
    from tools import get_workspace_info

    now = datetime.now(timezone.utc)
    uptime_seconds = (now - startup_time).total_seconds() if startup_time else 0

    # Get workspace configuration
    workspace_info = get_workspace_info()

    return {
        'status': 'healthy' if workflow_data and not startup_warnings else 'degraded',
        'workflow_loaded': workflow_data is not None,
        'uptime_seconds': round(uptime_seconds, 2),
        'warnings': startup_warnings if startup_warnings else None,
        'workspace': workspace_info,
        'timestamp': now.isoformat()
    }

@app.get("/ready")
async def readiness():
    """Readiness check - is the service ready to handle requests?"""
    if not workflow_data:
        raise HTTPException(status_code=503, detail='Workflow not loaded')
    return {'ready': True}

@app.post("/execute")
async def execute(request: ExecuteRequest):
    if not workflow_data:
        raise HTTPException(status_code=500, detail="No workflow loaded")

    executor = WorkflowExecutor(workflow_data)

    # Get initial workflow variables from environment
    initial_vars = {}
    for key, value in os.environ.items():
        if key.startswith('WORKFLOW_VAR_'):
            var_name = key[len('WORKFLOW_VAR_'):]
            # Try to parse JSON values
            try:
                initial_vars[var_name] = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                initial_vars[var_name] = value

    result = await executor.run(request.model_dump(), workflow_variables=initial_vars)
    return result
