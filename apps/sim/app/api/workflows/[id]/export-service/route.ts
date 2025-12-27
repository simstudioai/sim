import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'

const logger = createLogger('ExportService')

// Supported block types for export
const SUPPORTED_BLOCK_TYPES = new Set([
  'start_trigger',
  'start',
  'agent',
  'function',
  'condition',
  'router',
  'api',
  'variables',
  'response',
  'loop',
  'loop_block',
])

// Supported providers for agent blocks
const SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai', 'google'])

// Provider detection from model name
function detectProviderFromModel(model: string): string {
  const modelLower = model.toLowerCase()
  if (modelLower.includes('claude')) return 'anthropic'
  if (modelLower.includes('gpt') || modelLower.includes('o1-') || modelLower.includes('o3-')) return 'openai'
  if (modelLower.includes('gemini')) return 'google'
  return 'unknown'
}

interface ValidationResult {
  valid: boolean
  unsupportedBlocks: Array<{ id: string; name: string; type: string }>
  unsupportedProviders: Array<{ id: string; name: string; model: string; provider: string }>
  message: string
}

/**
 * Validate workflow for export compatibility.
 * Checks for unsupported block types and providers.
 */
function validateWorkflowForExport(state: any): ValidationResult {
  const unsupportedBlocks: Array<{ id: string; name: string; type: string }> = []
  const unsupportedProviders: Array<{ id: string; name: string; model: string; provider: string }> = []

  const blocks = state?.blocks || {}

  for (const [blockId, block] of Object.entries(blocks)) {
    const b = block as any
    const blockType = b.type

    // Check if block type is supported
    if (!SUPPORTED_BLOCK_TYPES.has(blockType)) {
      unsupportedBlocks.push({
        id: blockId,
        name: b.name || blockId,
        type: blockType,
      })
    }

    // For agent blocks, check if the provider is supported
    if (blockType === 'agent') {
      const model = b.subBlocks?.model?.value || b.inputs?.model || ''
      const provider = detectProviderFromModel(model)

      if (!SUPPORTED_PROVIDERS.has(provider)) {
        unsupportedProviders.push({
          id: blockId,
          name: b.name || blockId,
          model: model,
          provider: provider,
        })
      }
    }
  }

  const valid = unsupportedBlocks.length === 0 && unsupportedProviders.length === 0

  let message = ''
  if (!valid) {
    const parts: string[] = []
    if (unsupportedBlocks.length > 0) {
      const types = [...new Set(unsupportedBlocks.map(b => b.type))]
      parts.push(`Unsupported block types: ${types.join(', ')}`)
    }
    if (unsupportedProviders.length > 0) {
      const providers = [...new Set(unsupportedProviders.map(p => p.provider))]
      parts.push(`Unsupported providers: ${providers.join(', ')}. Supported: Anthropic (Claude), OpenAI (GPT), Google (Gemini)`)
    }
    message = parts.join('. ')
  }

  return { valid, unsupportedBlocks, unsupportedProviders, message }
}

/**
 * Transpile JavaScript code to Python.
 * This runs at export time so the exported service doesn't need a transpiler.
 */
function transpileJsToPython(code: string): string {
  // Transform comments
  code = code.replace(/\/\/(.*)$/gm, '#$1')

  // Transform var/let/const declarations
  code = code.replace(/\b(var|let|const)\s+/g, '')

  // Transform operators
  code = code.replace(/===/g, '==')
  code = code.replace(/!==/g, '!=')
  code = code.replace(/&&/g, ' and ')
  code = code.replace(/\|\|/g, ' or ')
  // Be careful with ! - only replace standalone not
  code = code.replace(/(?<![a-zA-Z0-9_])!(?![=])/g, 'not ')

  // Transform literals (use word boundaries to avoid partial matches)
  code = code.replace(/\bnull\b/g, 'None')
  code = code.replace(/\bundefined\b/g, 'None')
  code = code.replace(/\btrue\b/g, 'True')
  code = code.replace(/\bfalse\b/g, 'False')

  // Transform array methods - handle .length property
  code = code.replace(/(\b[a-zA-Z_][a-zA-Z0-9_]*(?:\[[^\]]*\])*)\.length\b/g, 'len($1)')
  code = code.replace(/\.push\(/g, '.append(')
  code = code.replace(/Array\.isArray\(([^)]+)\)/g, 'isinstance($1, list)')

  // Wrap len() with str() when used in string concatenation
  // Pattern: 'string' + len(...) or len(...) + 'string'
  code = code.replace(/(['"][^'"]*['"])\s*\+\s*(len\([^)]+\))/g, '$1 + str($2)')
  code = code.replace(/(len\([^)]+\))\s*\+\s*(['"][^'"]*['"])/g, 'str($1) + $2')

  // Transform property access (but not method calls)
  code = code.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\[[^\]]+\])*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])(?!\s*\()/g,
    '$1["$2"]'
  )

  // Transform object literal keys: { key: value } -> { 'key': value }
  code = code.replace(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "{ '$1':")
  code = code.replace(/,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, ", '$1':")

  // Transform control structures
  const lines = code.split('\n')
  const result: string[] = []

  for (const line of lines) {
    const stripped = line.trim()
    const leading = line.length - line.trimStart().length
    const indent = ' '.repeat(leading)

    // if/else if/else
    if (stripped.startsWith('if ') && stripped.endsWith('{')) {
      let condition = stripped.slice(3, -1).trim()
      if (condition.startsWith('(')) condition = condition.slice(1)
      if (condition.endsWith(')')) condition = condition.slice(0, -1)
      result.push(`${indent}if ${condition}:`)
      continue
    } else if (stripped.startsWith('} else if ') || stripped.startsWith('else if ')) {
      let condition = stripped.replace('} else if ', '').replace('else if ', '')
      condition = condition.slice(0, -1).trim()
      if (condition.startsWith('(')) condition = condition.slice(1)
      if (condition.endsWith(')')) condition = condition.slice(0, -1)
      result.push(`${indent}elif ${condition}:`)
      continue
    } else if (stripped === '} else {' || stripped === 'else {') {
      result.push(`${indent}else:`)
      continue
    } else if (stripped === '}') {
      continue
    }

    // return statements
    if (stripped.startsWith('return ')) {
      const value = stripped.slice(7).replace(/;$/, '')
      result.push(`${indent}__return__ = ${value}`)
      continue
    }

    // Remove semicolons
    let processedLine = line
    if (stripped.endsWith(';')) {
      processedLine = line.trimEnd().slice(0, -1)
    }

    result.push(processedLine)
  }

  return result.join('\n')
}

/**
 * Pre-transpile all JavaScript function blocks in a workflow state to Python.
 * Handles the ExportWorkflowState structure: {version, exportedAt, state: {blocks, ...}}
 */
function preTranspileWorkflow(exportState: any): any {
  // Handle ExportWorkflowState structure
  const blocks = exportState?.state?.blocks
  if (!blocks) return exportState

  for (const blockId of Object.keys(blocks)) {
    const block = blocks[blockId]
    if (block.type === 'function') {
      const codeSubBlock = block.subBlocks?.code
      const langSubBlock = block.subBlocks?.language

      if (codeSubBlock?.value && langSubBlock?.value === 'javascript') {
        // Transpile JavaScript to Python
        codeSubBlock.value = transpileJsToPython(codeSubBlock.value)
        // Update language to python
        langSubBlock.value = 'python'
      }
    }
  }

  return exportState
}

// Python executor files - these are bundled into the export
const EXECUTOR_FILES = {
  'main.py': `"""FastAPI server for workflow execution."""
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
    \"\"\"Validate required environment variables and return warnings.\"\"\"
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
    \"\"\"Request model for workflow execution.\"\"\"
    class Config:
        extra = 'allow'

@app.get("/health")
async def health():
    \"\"\"Health check endpoint with detailed status.\"\"\"
    now = datetime.now(timezone.utc)
    uptime_seconds = (now - startup_time).total_seconds() if startup_time else 0

    return {
        'status': 'healthy' if workflow_data and not startup_warnings else 'degraded',
        'workflow_loaded': workflow_data is not None,
        'uptime_seconds': round(uptime_seconds, 2),
        'warnings': startup_warnings if startup_warnings else None,
        'timestamp': now.isoformat()
    }

@app.get("/ready")
async def readiness():
    \"\"\"Readiness check - is the service ready to handle requests?\"\"\"
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
`,

  'executor.py': `"""DAG-based workflow executor with loop and condition support."""
import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from resolver import ReferenceResolver

MAX_LOOP_ITERATIONS = 1000  # Safety limit

@dataclass
class Block:
    id: str
    name: str
    type: str
    parent_id: Optional[str] = None
    inputs: Dict[str, Any] = field(default_factory=dict)
    outputs: Dict[str, Any] = field(default_factory=dict)

@dataclass
class LoopState:
    \"\"\"Tracks state for a loop iteration.\"\"\"
    iteration: int = 0
    items: List[Any] = field(default_factory=list)
    current_item: Any = None
    max_iterations: int = MAX_LOOP_ITERATIONS
    loop_type: str = 'for'
    condition: Optional[str] = None
    iteration_outputs: List[Dict[str, Any]] = field(default_factory=list)

@dataclass
class ExecutionContext:
    inputs: Dict[str, Any]
    block_outputs: Dict[str, Any] = field(default_factory=dict)
    workflow_variables: Dict[str, Any] = field(default_factory=dict)
    logs: List[Dict[str, Any]] = field(default_factory=list)
    loop_states: Dict[str, LoopState] = field(default_factory=dict)
    current_loop_id: Optional[str] = None

class WorkflowExecutor:
    def __init__(self, workflow_data: Dict[str, Any]):
        self.workflow = workflow_data
        self.raw_blocks = self._get_raw_blocks()
        self.blocks = self._parse_blocks()
        self.edges = self._parse_edges()
        self.resolver = ReferenceResolver()
        self._load_handlers()
        self._build_graph()

    def _get_raw_blocks(self) -> Dict[str, Any]:
        raw = self.workflow.get('blocks', {})
        if isinstance(raw, dict):
            return raw
        # Convert list to dict
        return {b['id']: b for b in raw}

    def _parse_blocks(self) -> Dict[str, Block]:
        blocks = {}
        for block_id, block_data in self.raw_blocks.items():
            inputs = block_data.get('inputs', {})
            if not inputs and 'subBlocks' in block_data:
                inputs = self._flatten_sub_blocks(block_data['subBlocks'])

            block = Block(
                id=block_data['id'],
                name=block_data.get('name', block_data['id']),
                type=block_data.get('type', 'unknown'),
                parent_id=block_data.get('parentId') or block_data.get('data', {}).get('parentId'),
                inputs=inputs,
                outputs=block_data.get('outputs', {})
            )
            blocks[block.id] = block
        return blocks

    def _flatten_sub_blocks(self, sub_blocks: Dict[str, Any]) -> Dict[str, Any]:
        result = {}
        for key, sub_block in sub_blocks.items():
            if isinstance(sub_block, dict) and 'value' in sub_block:
                value = sub_block['value']
                if key == 'messages' and isinstance(value, list) and value:
                    contents = [msg.get('content', '') for msg in value if isinstance(msg, dict)]
                    result[key] = '\\n'.join(contents)
                else:
                    result[key] = value
            else:
                result[key] = sub_block
        return result

    def _parse_edges(self) -> List[Dict[str, Any]]:
        raw_edges = self.workflow.get('edges', {})
        if isinstance(raw_edges, dict):
            return list(raw_edges.values())
        return raw_edges

    def _load_handlers(self):
        from handlers.agent import AgentBlockHandler
        from handlers.function import FunctionBlockHandler
        from handlers.condition import ConditionBlockHandler
        from handlers.api import ApiBlockHandler
        from handlers.variables import VariablesBlockHandler
        from handlers.response import ResponseBlockHandler
        from handlers.start import StartBlockHandler

        self.handlers = [
            StartBlockHandler(),
            AgentBlockHandler(),
            FunctionBlockHandler(),
            ConditionBlockHandler(),
            ApiBlockHandler(),
            VariablesBlockHandler(),
            ResponseBlockHandler(),
        ]

    def _get_handler(self, block: Block):
        for handler in self.handlers:
            if handler.can_handle(block):
                return handler
        return None

    def _build_graph(self):
        \"\"\"Build execution graph and identify loop children.\"\"\"
        self.graph = defaultdict(list)
        self.in_degree = defaultdict(int)
        self.loop_children: Dict[str, List[str]] = defaultdict(list)

        for block_id in self.blocks:
            self.in_degree[block_id] = 0

        for edge in self.edges:
            source = edge.get('source')
            target = edge.get('target')
            if source and target:
                self.graph[source].append(target)
                self.in_degree[target] += 1

        # Identify blocks that belong to loops (via parentId)
        for block_id, block in self.blocks.items():
            if block.parent_id and block.parent_id in self.blocks:
                parent = self.blocks[block.parent_id]
                if parent.type in ('loop', 'loop_block'):
                    self.loop_children[block.parent_id].append(block_id)

    def _get_execution_order(self, block_ids: Set[str]) -> List[str]:
        \"\"\"Get topological order for a subset of blocks.\"\"\"
        # Filter graph to only include specified blocks
        in_deg = {bid: 0 for bid in block_ids}

        for edge in self.edges:
            source = edge.get('source')
            target = edge.get('target')
            if source in block_ids and target in block_ids:
                in_deg[target] = in_deg.get(target, 0) + 1

        queue = [bid for bid in block_ids if in_deg.get(bid, 0) == 0]
        order = []

        while queue:
            current = queue.pop(0)
            order.append(current)
            for edge in self.edges:
                if edge.get('source') == current and edge.get('target') in block_ids:
                    target = edge['target']
                    in_deg[target] -= 1
                    if in_deg[target] == 0:
                        queue.append(target)

        return order

    def _get_top_level_blocks(self) -> Set[str]:
        \"\"\"Get blocks that are not children of any loop.\"\"\"
        all_loop_children = set()
        for children in self.loop_children.values():
            all_loop_children.update(children)
        return set(self.blocks.keys()) - all_loop_children

    async def _execute_block(self, ctx: 'ExecutionContext', block: Block) -> Dict[str, Any]:
        \"\"\"Execute a single block with retry logic.\"\"\"
        handler = self._get_handler(block)
        if not handler:
            return {'error': f'No handler for block type: {block.type}'}

        resolved_inputs = self.resolver.resolve(block.inputs, ctx)

        # Add loop context if inside a loop
        if ctx.current_loop_id and ctx.current_loop_id in ctx.loop_states:
            loop_state = ctx.loop_states[ctx.current_loop_id]
            resolved_inputs['_loop'] = {
                'index': loop_state.iteration,
                'item': loop_state.current_item,
                'items': loop_state.items
            }

        start_time = datetime.now(timezone.utc)
        max_retries = 3
        output = None
        success = False

        for attempt in range(max_retries):
            try:
                output = await handler.execute(ctx, block, resolved_inputs)
                success = True
                break
            except Exception as e:
                error_str = str(e).lower()
                transient = ['timeout', 'connection', 'rate limit', '429', '503']
                is_transient = any(t in error_str for t in transient)

                if is_transient and attempt < max_retries - 1:
                    await asyncio.sleep(1.0 * (2 ** attempt))
                    continue
                else:
                    output = {'error': str(e), 'retries': attempt}
                    success = False
                    break

        end_time = datetime.now(timezone.utc)

        # Store output
        block_key = block.name.lower().replace(' ', '_')
        ctx.block_outputs[block_key] = output
        ctx.block_outputs[block.name] = output

        ctx.logs.append({
            'blockId': block.id,
            'blockName': block.name,
            'blockType': block.type,
            'startedAt': start_time.isoformat(),
            'success': success,
            'output': output,
            'endedAt': end_time.isoformat()
        })

        return output

    async def _execute_loop(self, ctx: 'ExecutionContext', loop_block: Block) -> Dict[str, Any]:
        \"\"\"Execute a loop block and iterate over its children.\"\"\"
        inputs = self.resolver.resolve(loop_block.inputs, ctx)

        loop_type = inputs.get('loopType', 'for')
        iterations = min(inputs.get('iterations', 10), MAX_LOOP_ITERATIONS)
        for_each_items = inputs.get('forEachItems', [])
        condition = inputs.get('whileCondition') or inputs.get('doWhileCondition', '')

        # Initialize loop state
        state = LoopState(loop_type=loop_type, condition=condition)

        if loop_type == 'forEach':
            items = self._resolve_items(for_each_items, ctx)
            state.items = items
            state.max_iterations = len(items)
        else:
            state.max_iterations = iterations

        ctx.loop_states[loop_block.id] = state
        prev_loop_id = ctx.current_loop_id
        ctx.current_loop_id = loop_block.id

        # Get child blocks in execution order
        child_ids = set(self.loop_children.get(loop_block.id, []))
        child_order = self._get_execution_order(child_ids)

        all_results = []

        # Execute iterations
        while self._should_continue_loop(state, ctx):
            # Set current item for forEach
            if loop_type == 'forEach' and state.iteration < len(state.items):
                state.current_item = state.items[state.iteration]

            iteration_results = {}

            # Execute each child block in order
            for child_id in child_order:
                child_block = self.blocks.get(child_id)
                if child_block:
                    result = await self._execute_block(ctx, child_block)
                    iteration_results[child_block.name] = result

            all_results.append(iteration_results)
            state.iteration_outputs.append(iteration_results)

            # Advance iteration
            state.iteration += 1
            if state.iteration >= MAX_LOOP_ITERATIONS:
                break

        # Restore previous loop context
        ctx.current_loop_id = prev_loop_id

        # Store loop results
        loop_output = {
            'results': all_results,
            'totalIterations': state.iteration,
            'status': 'completed'
        }

        block_key = loop_block.name.lower().replace(' ', '_')
        ctx.block_outputs[block_key] = loop_output
        ctx.block_outputs[loop_block.name] = loop_output

        return loop_output

    def _resolve_items(self, items: Any, ctx: 'ExecutionContext') -> List[Any]:
        if items is None:
            return []
        if isinstance(items, list):
            return items
        if isinstance(items, dict):
            return list(items.items())
        if isinstance(items, str):
            resolved = self.resolver.resolve(items, ctx)
            if isinstance(resolved, list):
                return resolved
            if isinstance(resolved, dict):
                return list(resolved.items())
            try:
                parsed = json.loads(items)
                return parsed if isinstance(parsed, list) else [parsed]
            except:
                return [items] if items else []
        return []

    def _should_continue_loop(self, state: LoopState, ctx: 'ExecutionContext') -> bool:
        if state.iteration >= state.max_iterations:
            return False

        if state.loop_type == 'for':
            return state.iteration < state.max_iterations
        elif state.loop_type == 'forEach':
            return state.iteration < len(state.items)
        elif state.loop_type == 'while':
            return self._evaluate_condition(state.condition, state, ctx)
        elif state.loop_type == 'doWhile':
            if state.iteration == 0:
                return True
            return self._evaluate_condition(state.condition, state, ctx)
        return False

    def _evaluate_condition(self, condition: str, state: LoopState, ctx: 'ExecutionContext') -> bool:
        if not condition:
            return state.iteration < state.max_iterations

        try:
            # Replace loop variables
            cond = condition.replace('<loop.index>', str(state.iteration))
            cond = cond.replace('<loop.iteration>', str(state.iteration))
            if state.current_item is not None:
                item_str = json.dumps(state.current_item) if isinstance(state.current_item, (dict, list)) else repr(state.current_item)
                cond = cond.replace('<loop.item>', item_str)

            cond = self.resolver.resolve(cond, ctx)

            safe_globals = {'__builtins__': {'len': len, 'str': str, 'int': int, 'True': True, 'False': False, 'None': None}}
            return bool(eval(cond, safe_globals, {}))
        except:
            return state.iteration < state.max_iterations

    async def run(
        self,
        inputs: Dict[str, Any],
        workflow_variables: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        ctx = ExecutionContext(
            inputs=inputs,
            workflow_variables=workflow_variables or {}
        )

        # Get top-level blocks (not inside any loop)
        top_level = self._get_top_level_blocks()
        execution_order = self._get_execution_order(top_level)

        final_output = None

        for block_id in execution_order:
            block = self.blocks.get(block_id)
            if not block:
                continue

            # Handle loop blocks specially
            if block.type in ('loop', 'loop_block'):
                output = await self._execute_loop(ctx, block)
            else:
                output = await self._execute_block(ctx, block)

            if block.type in ('response', 'output'):
                final_output = output

        return {
            'success': True,
            'output': final_output,
            'error': None,
            'logs': ctx.logs
        }
`,

  'resolver.py': `"""Reference resolver for workflow block references."""
import re
from typing import Any, Dict, List, Union

class ReferenceResolver:
    # Pattern: <blockName.field> or <blockName["field"]> or <blockName["field"].subfield>
    # Supports both dot notation and bracket notation (with single or double quotes)
    REFERENCE_PATTERN = re.compile(
        r'<([a-zA-Z_][a-zA-Z0-9_]*'  # Block name
        r'(?:'
        r'\\.[a-zA-Z_][a-zA-Z0-9_]*'  # .field (dot notation)
        r'|'
        r'\\[["\\'][^"\\'\\']+["\\']\\]'  # ["field"] or ['field'] (bracket notation)
        r')*'
        r')>'
    )

    def resolve(self, value: Any, ctx: 'ExecutionContext') -> Any:
        if isinstance(value, str):
            return self._resolve_string(value, ctx)
        elif isinstance(value, dict):
            return {k: self.resolve(v, ctx) for k, v in value.items()}
        elif isinstance(value, list):
            return [self.resolve(item, ctx) for item in value]
        return value

    def _resolve_string(self, value: str, ctx: 'ExecutionContext') -> Any:
        # Check if entire string is a single reference
        match = self.REFERENCE_PATTERN.fullmatch(value.strip())
        if match:
            result = self._lookup_reference(match.group(1), ctx)
            # Return None as-is for single references (handler will deal with it)
            return result

        # Replace embedded references
        def replace_ref(m):
            result = self._lookup_reference(m.group(1), ctx)
            if result is None:
                # Return 'null' for JavaScript/Python code compatibility
                return 'null'
            if isinstance(result, bool):
                # Python boolean literals
                return 'True' if result else 'False'
            if isinstance(result, (dict, list)):
                import json
                return json.dumps(result)
            if isinstance(result, (int, float)):
                return str(result)
            return str(result)

        return self.REFERENCE_PATTERN.sub(replace_ref, value)

    def _parse_path(self, path: str) -> List[str]:
        """Parse a path like 'block["field"].subfield' into parts ['block', 'field', 'subfield']."""
        parts = []
        current = ''
        i = 0

        while i < len(path):
            char = path[i]

            if char == '.':
                if current:
                    parts.append(current)
                    current = ''
                i += 1
            elif char == '[':
                if current:
                    parts.append(current)
                    current = ''
                # Find the closing bracket and extract the key
                i += 1
                if i < len(path) and path[i] in ('"', "'"):
                    quote = path[i]
                    i += 1
                    key = ''
                    while i < len(path) and path[i] != quote:
                        key += path[i]
                        i += 1
                    parts.append(key)
                    i += 1  # Skip closing quote
                    if i < len(path) and path[i] == ']':
                        i += 1  # Skip closing bracket
            else:
                current += char
                i += 1

        if current:
            parts.append(current)

        return parts

    def _lookup_reference(self, path: str, ctx: 'ExecutionContext') -> Any:
        parts = self._parse_path(path)

        if not parts:
            return None

        # Handle special cases
        if parts[0] == 'start':
            current = ctx.inputs
            parts = parts[1:]
        elif parts[0] == 'variable':
            current = ctx.workflow_variables
            parts = parts[1:]
        else:
            # Look up block output by name
            block_name = parts[0].lower().replace(' ', '_')
            current = ctx.block_outputs.get(block_name) or ctx.block_outputs.get(parts[0])
            parts = parts[1:]

        # Navigate remaining path
        for part in parts:
            if current is None:
                return None
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list) and part.isdigit():
                idx = int(part)
                current = current[idx] if 0 <= idx < len(current) else None
            else:
                return None

        return current
`,

  'tools.py': `"""Native file and shell tools for workflow execution."""
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

# Sandbox configuration - all file operations restricted to this directory
WORKSPACE_DIR = Path(os.environ.get('WORKSPACE_DIR', './workspace')).resolve()

def _ensure_workspace():
    \"\"\"Ensure workspace directory exists.\"\"\"
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

def _safe_path(path: str) -> Path:
    \"\"\"
    Resolve a path safely within the workspace sandbox.
    Raises ValueError if path escapes the sandbox.
    \"\"\"
    _ensure_workspace()

    # Handle relative and absolute paths
    p = Path(path)
    if not p.is_absolute():
        p = WORKSPACE_DIR / p

    # Resolve to absolute path (resolves .., symlinks, etc.)
    resolved = p.resolve()

    # Check if path is within workspace
    try:
        resolved.relative_to(WORKSPACE_DIR)
    except ValueError:
        raise ValueError(f'Path escapes sandbox: {path} -> {resolved} is outside {WORKSPACE_DIR}')

    return resolved

def write_file(path: str, content: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        # Return path relative to workspace for cleaner output
        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'path': str(rel_path), 'absolute_path': str(p)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def read_file(path: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path)
        content = p.read_text()
        return {'success': True, 'content': content}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except FileNotFoundError:
        return {'success': False, 'error': f'File not found: {path}'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def execute_command(command: str, cwd: Optional[str] = None, use_shell: bool = False) -> Dict[str, Any]:
    \"\"\"
    Execute a shell command within the workspace sandbox.

    Args:
        command: The command to execute
        cwd: Working directory (must be within workspace, defaults to workspace root)
        use_shell: If True, use shell=True (allows pipes/redirects but less secure).
                   If False, parse command with shlex for safer execution.
    \"\"\"
    try:
        _ensure_workspace()

        # Validate and set working directory
        if cwd:
            work_dir = _safe_path(cwd)
        else:
            work_dir = WORKSPACE_DIR

        # Detect if command needs shell features (pipes, redirects, etc.)
        shell_chars = ['|', '>', '<', '&&', '||', ';', '$', '\`']
        needs_shell = use_shell or any(c in command for c in shell_chars)

        if needs_shell:
            # Use shell mode for complex commands
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=str(work_dir),
                timeout=300
            )
        else:
            # Use safer non-shell mode with shlex parsing
            args = shlex.split(command)
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                cwd=str(work_dir),
                timeout=300
            )

        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode,
            'cwd': str(work_dir)
        }
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Command timed out after 300 seconds'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def list_directory(path: str = '.') -> Dict[str, Any]:
    try:
        p = _safe_path(path)
        entries = []
        for entry in p.iterdir():
            rel_path = entry.relative_to(WORKSPACE_DIR)
            entries.append({
                'name': entry.name,
                'type': 'directory' if entry.is_dir() else 'file',
                'path': str(rel_path)
            })
        return {'success': True, 'entries': entries, 'workspace': str(WORKSPACE_DIR)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}
`,

  'handlers/__init__.py': '',

  'handlers/agent.py': `"""Agent block handler - calls LLM APIs with MCP tool support."""
import json
import os
import re
from typing import Any, Dict, List, Optional

import anthropic
import openai
import google.generativeai as genai

# MCP SDK imports
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

ENV_VAR_PATTERN = re.compile(r'\\{\\{([A-Z_][A-Z0-9_]*)\\}\\}')
MAX_TOOL_ITERATIONS = 50  # Prevent infinite loops
MAX_MESSAGE_HISTORY = 30  # Max conversation turns to keep
MAX_TOOL_RESULT_SIZE = 50000  # Truncate large tool results (chars)

# Provider detection patterns
ANTHROPIC_MODELS = ['claude-']
OPENAI_MODELS = ['gpt-', 'o1-', 'o3-']
GOOGLE_MODELS = ['gemini-']

def resolve_env_reference(value: str) -> Optional[str]:
    if not isinstance(value, str):
        return value
    match = ENV_VAR_PATTERN.match(value.strip())
    if match:
        return os.environ.get(match.group(1))
    return value

def detect_provider(model: str) -> str:
    \"\"\"Detect which provider to use based on model name.\"\"\"
    model_lower = model.lower()
    for prefix in ANTHROPIC_MODELS:
        if prefix in model_lower:
            return 'anthropic'
    for prefix in OPENAI_MODELS:
        if prefix in model_lower:
            return 'openai'
    for prefix in GOOGLE_MODELS:
        if prefix in model_lower:
            return 'google'
    # Default to anthropic
    return 'anthropic'

class AgentBlockHandler:
    def __init__(self):
        self.tool_registry: Dict[str, Dict[str, Any]] = {}

    def can_handle(self, block) -> bool:
        return block.type == 'agent'

    def _prune_messages(self, messages: List[Dict], keep_first: int = 1) -> List[Dict]:
        \"\"\"Prune old messages to prevent context overflow.

        Keeps the first message (original user request) and the most recent turns.
        \"\"\"
        if len(messages) <= MAX_MESSAGE_HISTORY:
            return messages

        # Keep first N messages + most recent messages
        keep_recent = MAX_MESSAGE_HISTORY - keep_first
        pruned = messages[:keep_first] + messages[-keep_recent:]

        # Insert a summary marker
        if len(pruned) > keep_first:
            pruned.insert(keep_first, {
                'role': 'user',
                'content': f'[Previous {len(messages) - MAX_MESSAGE_HISTORY} conversation turns omitted for context management]'
            })

        return pruned

    def _truncate_tool_result(self, result: str) -> str:
        \"\"\"Truncate large tool results to prevent memory exhaustion.\"\"\"
        if len(result) <= MAX_TOOL_RESULT_SIZE:
            return result

        # Try to preserve JSON structure
        truncated = result[:MAX_TOOL_RESULT_SIZE]
        return truncated + f'\\n... [truncated, {len(result) - MAX_TOOL_RESULT_SIZE} chars omitted]'

    def _get_api_key(self, inputs: Dict[str, Any], provider: str) -> Optional[str]:
        \"\"\"Get API key for the specified provider.\"\"\"
        # Check for explicit apiKey in inputs first
        if 'apiKey' in inputs:
            key = resolve_env_reference(inputs['apiKey'])
            if key:
                return key

        # Fall back to environment variables based on provider
        env_keys = {
            'anthropic': 'ANTHROPIC_API_KEY',
            'openai': 'OPENAI_API_KEY',
            'google': 'GOOGLE_API_KEY',
        }
        env_key = env_keys.get(provider, 'ANTHROPIC_API_KEY')
        return os.environ.get(env_key)

    def _build_tools(self, tools_config: List[Dict]) -> List[Dict]:
        """Build Claude tools from config and register for execution."""
        tools = []
        self.tool_registry = {}

        for tool in tools_config:
            tool_type = tool.get('type')
            tool_id = tool.get('toolId') or tool.get('title', '')

            if tool_type == 'mcp':
                # MCP tool - will be called via MCP SDK
                schema = tool.get('schema', {})
                tool_name = tool.get('params', {}).get('toolName') or tool.get('title', '')
                server_url = tool.get('params', {}).get('serverUrl', '')

                tools.append({
                    'name': tool_name,
                    'description': schema.get('description', f'MCP tool: {tool_name}'),
                    'input_schema': {
                        'type': schema.get('type', 'object'),
                        'properties': schema.get('properties', {}),
                        'required': schema.get('required', [])
                    }
                })

                self.tool_registry[tool_name] = {
                    'type': 'mcp',
                    'serverUrl': server_url,
                    'toolName': tool_name
                }

            elif tool_type == 'native':
                # Native tool - use local implementations from tools.py
                tool_name = tool.get('name', '')
                tools.append({
                    'name': tool_name,
                    'description': f'Native tool: {tool_name}',
                    'input_schema': tool.get('schema', {'type': 'object', 'properties': {}})
                })

                self.tool_registry[tool_name] = {
                    'type': 'native',
                    'name': tool_name
                }

        return tools

    async def _execute_tool(self, tool_name: str, tool_input: Dict) -> str:
        """Execute a tool and return the result as a string."""
        tool_info = self.tool_registry.get(tool_name)

        if not tool_info:
            return json.dumps({'error': f'Unknown tool: {tool_name}'})

        if tool_info['type'] == 'mcp':
            return await self._execute_mcp_tool(tool_info, tool_input)
        elif tool_info['type'] == 'native':
            return self._execute_native_tool(tool_info, tool_input)

        return json.dumps({'error': f'Unsupported tool type'})

    async def _execute_mcp_tool(self, tool_info: Dict, tool_input: Dict, timeout: float = 60.0) -> str:
        """Execute an MCP tool using the official MCP SDK with Streamable HTTP transport."""
        import asyncio
        import base64

        server_url = tool_info['serverUrl']
        tool_name = tool_info['toolName']

        async def _call_tool():
            async with streamable_http_client(server_url) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    return await session.call_tool(tool_name, arguments=tool_input)

        try:
            # Execute with timeout
            result = await asyncio.wait_for(_call_tool(), timeout=timeout)

            # Process the result content
            if result.content:
                texts = []
                for content_item in result.content:
                    if hasattr(content_item, 'text'):
                        texts.append(content_item.text)
                    elif hasattr(content_item, 'data'):
                        # Base64 encode binary data for proper handling
                        encoded = base64.b64encode(content_item.data).decode('utf-8')
                        mime_type = getattr(content_item, 'mimeType', 'application/octet-stream')
                        texts.append(json.dumps({
                            'type': 'binary',
                            'mimeType': mime_type,
                            'data': encoded,
                            'size': len(content_item.data)
                        }))
                    else:
                        texts.append(str(content_item))
                return '\\n'.join(texts) if texts else json.dumps({'result': 'empty'})

            return json.dumps({'result': 'success', 'content': []})

        except asyncio.TimeoutError:
            return json.dumps({'error': f'MCP tool {tool_name} timed out after {timeout}s'})
        except ConnectionError as e:
            return json.dumps({'error': f'Cannot connect to MCP server at {server_url}: {str(e)}'})
        except Exception as e:
            return json.dumps({'error': f'MCP tool error: {str(e)}'})

    def _execute_native_tool(self, tool_info: Dict, tool_input: Dict) -> str:
        """Execute a native tool using local implementations."""
        from tools import write_file, read_file, execute_command

        tool_name = tool_info['name']

        try:
            if tool_name == 'write_file':
                result = write_file(tool_input.get('path', ''), tool_input.get('content', ''))
            elif tool_name in ('read_file', 'read_text_file'):
                result = read_file(tool_input.get('path', ''))
            elif tool_name == 'execute_command':
                result = execute_command(tool_input.get('command', ''))
            else:
                result = {'error': f'Unknown native tool: {tool_name}'}

            return json.dumps(result)
        except Exception as e:
            return json.dumps({'error': str(e)})

    def _build_openai_tools(self, tools: List[Dict]) -> List[Dict]:
        \"\"\"Convert tools to OpenAI format.\"\"\"
        openai_tools = []
        for tool in tools:
            openai_tools.append({
                'type': 'function',
                'function': {
                    'name': tool['name'],
                    'description': tool.get('description', ''),
                    'parameters': tool.get('input_schema', {'type': 'object', 'properties': {}})
                }
            })
        return openai_tools

    def _build_google_tools(self, tools: List[Dict]) -> List:
        \"\"\"Convert tools to Google Gemini format.\"\"\"
        google_tools = []
        for tool in tools:
            google_tools.append({
                'name': tool['name'],
                'description': tool.get('description', ''),
                'parameters': tool.get('input_schema', {'type': 'object', 'properties': {}})
            })
        return google_tools

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        \"\"\"Route to the appropriate provider based on model.\"\"\"
        model = inputs.get('model', 'claude-sonnet-4-20250514')
        provider = detect_provider(model)

        api_key = self._get_api_key(inputs, provider)
        if not api_key:
            return {'error': f'No API key configured for {provider}. Set {provider.upper()}_API_KEY environment variable.'}

        # Build tools from config
        tools_config = inputs.get('tools', [])
        tools = self._build_tools(tools_config)

        # Route to provider-specific implementation
        if provider == 'anthropic':
            return await self._execute_anthropic(inputs, model, api_key, tools)
        elif provider == 'openai':
            return await self._execute_openai(inputs, model, api_key, tools)
        elif provider == 'google':
            return await self._execute_google(inputs, model, api_key, tools)
        else:
            return {'error': f'Unsupported provider: {provider}'}

    async def _execute_anthropic(self, inputs: Dict[str, Any], model: str, api_key: str, tools: List[Dict]) -> Dict[str, Any]:
        \"\"\"Execute using Anthropic Claude API.\"\"\"
        messages_text = inputs.get('messages', '')
        temperature = inputs.get('temperature', 0.7)
        response_format = inputs.get('responseFormat')

        MODEL_LIMITS = {
            'claude-opus-4': {'max_tokens': 16384, 'max_input_chars': 800000},
            'claude-sonnet-4': {'max_tokens': 8192, 'max_input_chars': 800000},
            'claude-haiku-3': {'max_tokens': 4096, 'max_input_chars': 400000},
        }
        model_key = next((k for k in MODEL_LIMITS if k in model), 'claude-sonnet-4')
        limits = MODEL_LIMITS.get(model_key, MODEL_LIMITS['claude-sonnet-4'])

        if len(messages_text) > limits['max_input_chars']:
            return {'error': f'Message too long for {model}', 'truncated_preview': messages_text[:500]}

        messages = [{'role': 'user', 'content': messages_text}]
        all_tool_calls = []

        try:
            client = anthropic.Anthropic(api_key=api_key)

            for iteration in range(MAX_TOOL_ITERATIONS):
                kwargs = {'model': model, 'max_tokens': limits['max_tokens'], 'messages': messages, 'temperature': temperature}
                if tools:
                    kwargs['tools'] = tools

                response = client.messages.create(**kwargs)
                assistant_content = []
                tool_uses = []
                final_text = ''

                for block in response.content:
                    if block.type == 'text':
                        final_text = block.text
                        assistant_content.append({'type': 'text', 'text': block.text})
                    elif block.type == 'tool_use':
                        tool_uses.append(block)
                        assistant_content.append({'type': 'tool_use', 'id': block.id, 'name': block.name, 'input': block.input})
                        all_tool_calls.append({'id': block.id, 'name': block.name, 'input': block.input})

                messages.append({'role': 'assistant', 'content': assistant_content})

                if not tool_uses or response.stop_reason == 'end_turn':
                    break

                tool_results = []
                for tool_use in tool_uses:
                    result = await self._execute_tool(tool_use.name, tool_use.input)
                    truncated = self._truncate_tool_result(result)
                    tool_results.append({'type': 'tool_result', 'tool_use_id': tool_use.id, 'content': truncated})
                    for tc in all_tool_calls:
                        if tc['id'] == tool_use.id:
                            tc['result'] = result

                messages.append({'role': 'user', 'content': tool_results})
                messages = self._prune_messages(messages)

            result = {'content': final_text, 'model': model, 'toolCalls': {'list': all_tool_calls, 'count': len(all_tool_calls)}}
            result = self._parse_json_response(result, final_text, response_format)
            return result

        except Exception as e:
            return {'error': str(e)}

    async def _execute_openai(self, inputs: Dict[str, Any], model: str, api_key: str, tools: List[Dict]) -> Dict[str, Any]:
        \"\"\"Execute using OpenAI API.\"\"\"
        messages_text = inputs.get('messages', '')
        temperature = inputs.get('temperature', 0.7)
        response_format = inputs.get('responseFormat')

        messages = [{'role': 'user', 'content': messages_text}]
        openai_tools = self._build_openai_tools(tools) if tools else None
        all_tool_calls = []

        try:
            client = openai.OpenAI(api_key=api_key)

            for iteration in range(MAX_TOOL_ITERATIONS):
                kwargs = {'model': model, 'messages': messages, 'temperature': temperature}
                if openai_tools:
                    kwargs['tools'] = openai_tools

                response = client.chat.completions.create(**kwargs)
                choice = response.choices[0]
                message = choice.message

                final_text = message.content or ''
                messages.append({'role': 'assistant', 'content': final_text, 'tool_calls': message.tool_calls})

                if not message.tool_calls or choice.finish_reason == 'stop':
                    break

                # Execute tool calls
                for tool_call in message.tool_calls:
                    func = tool_call.function
                    tool_input = json.loads(func.arguments) if func.arguments else {}
                    result = await self._execute_tool(func.name, tool_input)
                    truncated = self._truncate_tool_result(result)

                    all_tool_calls.append({'id': tool_call.id, 'name': func.name, 'input': tool_input, 'result': result})
                    messages.append({'role': 'tool', 'tool_call_id': tool_call.id, 'content': truncated})

                messages = self._prune_messages(messages)

            result = {'content': final_text, 'model': model, 'toolCalls': {'list': all_tool_calls, 'count': len(all_tool_calls)}}
            result = self._parse_json_response(result, final_text, response_format)
            return result

        except Exception as e:
            return {'error': str(e)}

    async def _execute_google(self, inputs: Dict[str, Any], model: str, api_key: str, tools: List[Dict]) -> Dict[str, Any]:
        \"\"\"Execute using Google Gemini API.\"\"\"
        messages_text = inputs.get('messages', '')
        temperature = inputs.get('temperature', 0.7)
        response_format = inputs.get('responseFormat')

        all_tool_calls = []

        try:
            genai.configure(api_key=api_key)

            # Build tool declarations for Gemini
            tool_declarations = None
            if tools:
                from google.generativeai.types import FunctionDeclaration, Tool
                func_declarations = []
                for tool in tools:
                    func_declarations.append(FunctionDeclaration(
                        name=tool['name'],
                        description=tool.get('description', ''),
                        parameters=tool.get('input_schema', {'type': 'object', 'properties': {}})
                    ))
                tool_declarations = [Tool(function_declarations=func_declarations)]

            gen_config = genai.GenerationConfig(temperature=temperature)
            gemini_model = genai.GenerativeModel(model, tools=tool_declarations, generation_config=gen_config)

            chat = gemini_model.start_chat()
            response = chat.send_message(messages_text)

            final_text = ''
            for iteration in range(MAX_TOOL_ITERATIONS):
                # Check for function calls
                function_calls = []
                for part in response.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        function_calls.append(part.function_call)
                    elif hasattr(part, 'text'):
                        final_text = part.text

                if not function_calls:
                    break

                # Execute function calls
                function_responses = []
                for fc in function_calls:
                    tool_input = dict(fc.args) if fc.args else {}
                    result = await self._execute_tool(fc.name, tool_input)
                    truncated = self._truncate_tool_result(result)

                    all_tool_calls.append({'id': fc.name, 'name': fc.name, 'input': tool_input, 'result': result})

                    from google.generativeai.types import FunctionResponse
                    function_responses.append(FunctionResponse(name=fc.name, response={'result': truncated}))

                # Send function responses back
                response = chat.send_message(function_responses)

                # Get final text from response
                for part in response.parts:
                    if hasattr(part, 'text'):
                        final_text = part.text

            result = {'content': final_text, 'model': model, 'toolCalls': {'list': all_tool_calls, 'count': len(all_tool_calls)}}
            result = self._parse_json_response(result, final_text, response_format)
            return result

        except Exception as e:
            return {'error': str(e)}

    def _parse_json_response(self, result: Dict, final_text: str, response_format: Any) -> Dict:
        \"\"\"Parse JSON from response if format specified.\"\"\"
        if response_format and final_text:
            try:
                parsed = json.loads(final_text)
                if isinstance(response_format, dict) and response_format.get('schema'):
                    try:
                        from jsonschema import validate, ValidationError
                        validate(instance=parsed, schema=response_format['schema'])
                        result['_schema_valid'] = True
                    except ValidationError as ve:
                        result['_schema_error'] = f'Schema validation failed: {ve.message}'
                    except Exception as e:
                        result['_schema_error'] = str(e)
                result.update(parsed)
            except json.JSONDecodeError as e:
                result['_parse_error'] = f'Failed to parse JSON: {str(e)}'
        return result
`,

  'handlers/function.py': `"""Function block handler - executes Python code (pre-transpiled at export time)."""
import json
import re
import traceback
from typing import Any, Dict

from resolver import ReferenceResolver

class FunctionBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type == 'function'

    def _build_context_dict(self, ctx, inputs: Dict[str, Any] = None) -> Dict[str, Any]:
        context_dict = {}
        context_dict['start'] = ctx.inputs
        context_dict['variable'] = ctx.workflow_variables
        for name, output in ctx.block_outputs.items():
            context_dict[name] = output
        # Include loop context if present
        if inputs and '_loop' in inputs:
            context_dict['_loop'] = inputs['_loop']
        return context_dict

    def _resolve_code_references(self, code: str, ctx) -> str:
        \"\"\"Resolve <block.field> references in code to Python literals.\"\"\"
        # Pattern matches <blockName.field> or <blockName["field"]>
        pattern = re.compile(
            r'<([a-zA-Z_][a-zA-Z0-9_]*'
            r'(?:\\.[a-zA-Z_][a-zA-Z0-9_]*|\\[["\\'][^"\\'\\']+["\\']\\])*'
            r')>'
        )

        def replace_ref(match):
            ref = match.group(0)  # Full match including < >
            result = self.resolver.resolve(ref, ctx)

            # Convert Python value to valid Python literal
            if result is None:
                return 'None'
            elif isinstance(result, bool):
                return 'True' if result else 'False'
            elif isinstance(result, str):
                # Escape and quote the string
                escaped = result.replace('\\\\', '\\\\\\\\').replace("'", "\\\\'")
                return f"'{escaped}'"
            elif isinstance(result, (int, float)):
                return str(result)
            elif isinstance(result, (dict, list)):
                return json.dumps(result)
            else:
                return repr(result)

        return pattern.sub(replace_ref, code)

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        # Code is already Python (transpiled at export time if originally JavaScript)
        code = inputs.get('code', '')

        # Resolve references in the code BEFORE compiling
        try:
            code = self._resolve_code_references(code, ctx)
        except Exception as e:
            return {'error': f'Failed to resolve references: {str(e)}', 'original_code': inputs.get('code', '')}

        exec_globals = {
            '__builtins__': __builtins__,
            'len': len,
            'str': str,
            'int': int,
            'float': float,
            'bool': bool,
            'list': list,
            'dict': dict,
            'isinstance': isinstance,
            'json': json,
            'context': self._build_context_dict(ctx, inputs),
        }
        exec_locals = {}

        try:
            compiled = compile(code, f'<{block.name}>', 'exec')
            exec(compiled, exec_globals, exec_locals)

            if '__return__' in exec_locals:
                return exec_locals['__return__']
            return {'executed': True}
        except Exception as e:
            return {'error': str(e), 'traceback': traceback.format_exc(), 'resolved_code': code}
`,

  'handlers/loop.py': `"""Loop block handler - executes loop iterations."""
import json
from typing import Any, Dict, List, Optional

MAX_LOOP_ITERATIONS = 1000  # Safety limit

class LoopScope:
    \"\"\"Tracks loop execution state.\"\"\"
    def __init__(self):
        self.iteration = 0
        self.items: List[Any] = []
        self.current_item: Any = None
        self.max_iterations: int = MAX_LOOP_ITERATIONS
        self.loop_type: str = 'for'
        self.condition: Optional[str] = None
        self.iteration_outputs: List[List[Dict]] = []
        self.current_iteration_outputs: Dict[str, Any] = {}

class LoopBlockHandler:
    def can_handle(self, block) -> bool:
        return block.type in ('loop', 'loop_block')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        \"\"\"
        Loop blocks are containers. The actual iteration is handled by the executor.
        This returns loop metadata for the executor to use.
        \"\"\"
        loop_type = inputs.get('loopType', 'for')
        iterations = inputs.get('iterations', 10)
        for_each_items = inputs.get('forEachItems', [])
        while_condition = inputs.get('whileCondition', '')
        do_while_condition = inputs.get('doWhileCondition', '')

        # Initialize loop scope
        scope = LoopScope()
        scope.loop_type = loop_type

        if loop_type == 'for':
            scope.max_iterations = min(iterations, MAX_LOOP_ITERATIONS)
        elif loop_type == 'forEach':
            items = self._resolve_items(for_each_items, ctx)
            scope.items = items
            scope.max_iterations = len(items)
            if items:
                scope.current_item = items[0]
        elif loop_type == 'while':
            scope.condition = while_condition
        elif loop_type == 'doWhile':
            scope.condition = do_while_condition or while_condition

        # Store scope in context for executor to use
        if not hasattr(ctx, 'loop_scopes'):
            ctx.loop_scopes = {}
        ctx.loop_scopes[block.id] = scope

        return {
            'status': 'loop_initialized',
            'loopType': loop_type,
            'maxIterations': scope.max_iterations,
            'itemCount': len(scope.items) if scope.items else 0
        }

    def _resolve_items(self, items: Any, ctx) -> List[Any]:
        \"\"\"Resolve forEach items to a list.\"\"\"
        if items is None:
            return []

        # Already a list
        if isinstance(items, list):
            return items

        # Dict -> convert to entries
        if isinstance(items, dict):
            return list(items.items())

        # String reference like "<block.output>"
        if isinstance(items, str):
            if items.startswith('<') and items.endswith('>'):
                # Try to resolve reference
                from resolver import ReferenceResolver
                resolver = ReferenceResolver()
                resolved = resolver.resolve(items, ctx)
                if isinstance(resolved, list):
                    return resolved
                if isinstance(resolved, dict):
                    return list(resolved.items())
                return [resolved] if resolved is not None else []

            # Try to parse as JSON
            try:
                parsed = json.loads(items.replace("'", '"'))
                if isinstance(parsed, list):
                    return parsed
                if isinstance(parsed, dict):
                    return list(parsed.items())
            except:
                pass

        return []

    def evaluate_condition(self, condition: str, scope: LoopScope, ctx) -> bool:
        \"\"\"Evaluate a loop condition.\"\"\"
        if not condition:
            return scope.iteration < scope.max_iterations

        # Replace loop variables
        eval_condition = condition
        eval_condition = eval_condition.replace('<loop.index>', str(scope.iteration))
        eval_condition = eval_condition.replace('<loop.iteration>', str(scope.iteration))

        if scope.current_item is not None:
            item_str = json.dumps(scope.current_item) if isinstance(scope.current_item, (dict, list)) else repr(scope.current_item)
            eval_condition = eval_condition.replace('<loop.item>', item_str)
            eval_condition = eval_condition.replace('<loop.currentItem>', item_str)

        # Resolve other references
        from resolver import ReferenceResolver
        resolver = ReferenceResolver()
        eval_condition = resolver.resolve(eval_condition, ctx)

        # Safely evaluate the condition
        try:
            # Create a safe evaluation context
            safe_globals = {
                '__builtins__': {
                    'len': len, 'str': str, 'int': int, 'float': float,
                    'bool': bool, 'list': list, 'dict': dict,
                    'True': True, 'False': False, 'None': None,
                    'abs': abs, 'min': min, 'max': max,
                }
            }
            result = eval(eval_condition, safe_globals, {})
            return bool(result)
        except Exception as e:
            # On error, check iteration limit
            return scope.iteration < scope.max_iterations

    def should_continue(self, scope: LoopScope, ctx) -> bool:
        \"\"\"Check if loop should continue to next iteration.\"\"\"
        if scope.loop_type == 'for':
            return scope.iteration < scope.max_iterations

        elif scope.loop_type == 'forEach':
            return scope.iteration < len(scope.items)

        elif scope.loop_type == 'while':
            return self.evaluate_condition(scope.condition, scope, ctx)

        elif scope.loop_type == 'doWhile':
            # First iteration always runs
            if scope.iteration == 0:
                return True
            return self.evaluate_condition(scope.condition, scope, ctx)

        return False

    def advance_iteration(self, scope: LoopScope):
        \"\"\"Move to next iteration.\"\"\"
        # Store current iteration outputs
        if scope.current_iteration_outputs:
            scope.iteration_outputs.append(list(scope.current_iteration_outputs.values()))
            scope.current_iteration_outputs = {}

        # Advance counter
        scope.iteration += 1

        # Update current item for forEach
        if scope.loop_type == 'forEach' and scope.iteration < len(scope.items):
            scope.current_item = scope.items[scope.iteration]

    def get_aggregated_results(self, scope: LoopScope) -> Dict[str, Any]:
        \"\"\"Get final aggregated results after loop completes.\"\"\"
        # Include any remaining outputs from last iteration
        if scope.current_iteration_outputs:
            scope.iteration_outputs.append(list(scope.current_iteration_outputs.values()))

        return {
            'results': scope.iteration_outputs,
            'totalIterations': scope.iteration,
            'status': 'loop_completed'
        }
`,

  'handlers/variables.py': `"""Variables block handler - updates workflow variables."""
from typing import Any, Dict
from resolver import ReferenceResolver

class VariablesBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type == 'variables'

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        variables = inputs.get('variables', [])
        updated = {}

        for var in variables:
            name = var.get('variableName')
            value = var.get('value')
            if name:
                # Resolve any references in the value
                resolved_value = self.resolver.resolve(value, ctx)
                ctx.workflow_variables[name] = resolved_value
                updated[name] = resolved_value

        return {'updated': updated, 'variables': list(ctx.workflow_variables.keys())}
`,

  'handlers/response.py': `"""Response block handler - formats final output."""
from typing import Any, Dict, Optional
from resolver import ReferenceResolver

class ResponseBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type in ('response', 'output')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        data_mode = inputs.get('dataMode', 'raw')
        status = inputs.get('status')
        headers = inputs.get('headers', [])
        data = inputs.get('data')
        builder_data = inputs.get('builderData', [])

        # Resolve any references in the data
        resolved_data = self.resolver.resolve(data, ctx) if data else None

        # Build response based on dataMode
        if data_mode == 'structured' and builder_data:
            # Build structured response from builderData
            structured = {}
            for field in builder_data:
                name = field.get('name')
                value = field.get('value')
                if name:
                    # Resolve references in field values
                    resolved_value = self.resolver.resolve(value, ctx) if value else None
                    structured[name] = resolved_value
            response_data = structured
        elif data_mode == 'raw' and resolved_data:
            response_data = resolved_data
        else:
            # Fallback: return all inputs
            response_data = resolved_data or inputs

        # Build headers dict
        headers_dict = {}
        for header in headers:
            cells = header.get('cells', {})
            key = cells.get('Key', '').strip()
            value = cells.get('Value', '').strip()
            if key:
                headers_dict[key] = self.resolver.resolve(value, ctx)

        return {
            'data': response_data,
            'status': status,
            'headers': headers_dict if headers_dict else None,
            'dataMode': data_mode
        }
`,

  'handlers/start.py': `"""Start block handler - receives workflow input."""
from typing import Any, Dict

class StartBlockHandler:
    def can_handle(self, block) -> bool:
        return block.type in ('start', 'start_trigger', 'starter')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        return ctx.inputs
`,

  'handlers/condition.py': `"""Condition/Router block handler - evaluates conditions and controls flow."""
import json
from typing import Any, Dict, List, Optional
from resolver import ReferenceResolver

class ConditionBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type in ('condition', 'router', 'if', 'switch')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        \"\"\"
        Evaluate conditions and return which branch to take.

        Supports multiple condition formats:
        - Simple condition: { condition: 'x > 5' }
        - Multiple routes: { routes: [{condition: '...', target: '...'}, ...] }
        - If/else: { if: '...', then: '...', else: '...' }
        \"\"\"
        # Get condition(s) from inputs
        condition = inputs.get('condition', '')
        routes = inputs.get('routes', [])
        if_condition = inputs.get('if', '')

        # Simple single condition
        if condition:
            resolved = self.resolver.resolve(condition, ctx)
            result = self._evaluate(resolved, ctx)
            return {
                'result': result,
                'branch': 'true' if result else 'false',
                'condition': condition
            }

        # If/then/else format
        if if_condition:
            resolved = self.resolver.resolve(if_condition, ctx)
            result = self._evaluate(resolved, ctx)
            return {
                'result': result,
                'branch': 'then' if result else 'else',
                'condition': if_condition
            }

        # Multiple routes (router pattern)
        if routes:
            for i, route in enumerate(routes):
                route_condition = route.get('condition', '')
                if route_condition:
                    resolved = self.resolver.resolve(route_condition, ctx)
                    if self._evaluate(resolved, ctx):
                        return {
                            'result': True,
                            'branch': route.get('name', f'route_{i}'),
                            'matchedRoute': i,
                            'condition': route_condition
                        }

            # No route matched - use default/else
            return {
                'result': False,
                'branch': 'default',
                'matchedRoute': None
            }

        # No condition specified - pass through
        return {'result': True, 'branch': 'default'}

    def _evaluate(self, condition: Any, ctx) -> bool:
        \"\"\"Safely evaluate a condition.\"\"\"
        # Already a boolean
        if isinstance(condition, bool):
            return condition

        # Falsy values
        if condition is None or condition == '' or condition == 0:
            return False

        # Truthy non-string values
        if not isinstance(condition, str):
            return bool(condition)

        # String conditions - evaluate as Python expression
        try:
            # Build evaluation context with block outputs
            eval_context = {
                'start': ctx.inputs,
                'variable': ctx.workflow_variables,
                **ctx.block_outputs
            }

            safe_globals = {
                '__builtins__': {
                    'len': len, 'str': str, 'int': int, 'float': float,
                    'bool': bool, 'list': list, 'dict': dict,
                    'True': True, 'False': False, 'None': None,
                    'abs': abs, 'min': min, 'max': max,
                    'isinstance': isinstance, 'type': type,
                }
            }

            result = eval(condition, safe_globals, eval_context)
            return bool(result)
        except Exception as e:
            # On error, treat as false
            return False
`,

  'handlers/api.py': `"""API block handler - makes HTTP requests."""
import json
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx

from resolver import ReferenceResolver

class ApiBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type in ('api', 'http', 'request', 'webhook')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        \"\"\"
        Make an HTTP request.

        Inputs:
        - url: The URL to request
        - method: HTTP method (GET, POST, PUT, DELETE, PATCH)
        - headers: Dict or list of headers
        - body: Request body (for POST/PUT/PATCH)
        - params: Query parameters
        - timeout: Request timeout in seconds
        \"\"\"
        url = inputs.get('url', '')
        method = inputs.get('method', 'GET').upper()
        headers_input = inputs.get('headers', {})
        body = inputs.get('body')
        params = inputs.get('params', {})
        timeout = inputs.get('timeout', 30)

        if not url:
            return {'error': 'No URL provided'}

        # Resolve any references in the URL
        url = self.resolver.resolve(url, ctx)
        if isinstance(url, str) and url.startswith('<'):
            return {'error': f'Failed to resolve URL reference: {url}'}

        # Build headers dict
        headers = {}
        if isinstance(headers_input, dict):
            for k, v in headers_input.items():
                resolved = self.resolver.resolve(v, ctx)
                headers[k] = str(resolved) if resolved is not None else ''
        elif isinstance(headers_input, list):
            for h in headers_input:
                if isinstance(h, dict):
                    cells = h.get('cells', h)
                    key = cells.get('Key', cells.get('key', ''))
                    value = cells.get('Value', cells.get('value', ''))
                    if key:
                        resolved = self.resolver.resolve(value, ctx)
                        headers[key] = str(resolved) if resolved is not None else ''

        # Resolve body
        if body:
            body = self.resolver.resolve(body, ctx)

        # Resolve params
        if params:
            resolved_params = {}
            if isinstance(params, dict):
                for k, v in params.items():
                    resolved_params[k] = self.resolver.resolve(v, ctx)
            params = resolved_params

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # Prepare request kwargs
                kwargs: Dict[str, Any] = {
                    'method': method,
                    'url': url,
                    'headers': headers,
                }

                if params:
                    kwargs['params'] = params

                # Add body for methods that support it
                if method in ('POST', 'PUT', 'PATCH') and body is not None:
                    if isinstance(body, (dict, list)):
                        kwargs['json'] = body
                        if 'Content-Type' not in headers:
                            headers['Content-Type'] = 'application/json'
                    else:
                        kwargs['content'] = str(body)

                response = await client.request(**kwargs)

                # Parse response
                response_data = None
                content_type = response.headers.get('content-type', '')

                if 'application/json' in content_type:
                    try:
                        response_data = response.json()
                    except:
                        response_data = response.text
                else:
                    response_data = response.text

                return {
                    'status': response.status_code,
                    'statusText': response.reason_phrase,
                    'headers': dict(response.headers),
                    'data': response_data,
                    'ok': response.is_success,
                    'url': str(response.url)
                }

        except httpx.TimeoutException:
            return {'error': f'Request timed out after {timeout}s', 'url': url}
        except httpx.ConnectError as e:
            return {'error': f'Connection failed: {str(e)}', 'url': url}
        except Exception as e:
            return {'error': str(e), 'url': url}
`,

  'requirements.txt': `# Workflow Runner Dependencies
anthropic>=0.18.0
openai>=1.0.0
google-generativeai>=0.3.0
fastapi>=0.109.0
uvicorn>=0.27.0
httpx>=0.26.0
mcp>=1.0.0
pydantic>=2.5.0
python-dotenv>=1.0.0
jsonschema>=4.20.0
`,

  'Dockerfile': `# Workflow Service Container
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser && \\
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:8080/health || exit 1

# Run server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
`,

  'docker-compose.yml': `# Docker Compose for local development
version: '3.8'

services:
  workflow:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env
    environment:
      - PYTHONUNBUFFERED=1
    restart: unless-stopped
`,

  '.gitignore': `# Environment files with secrets
.env
.env.local
.env.production

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.venv/
venv/
ENV/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
`,
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workflowId } = await params

    // Authenticate - support both session and API key
    const session = await getSession()
    let userId: string | null = session?.user?.id || null

    if (!userId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
        if (authResult.success && authResult.userId) {
          userId = authResult.userId
          if (authResult.keyId) {
            await updateApiKeyLastUsed(authResult.keyId).catch((error) => {
              logger.warn('Failed to update API key last used timestamp:', { error })
            })
          }
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workflow
    const [workflowRow] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workspaceId = workflowRow.workspaceId

    // Build headers for internal API calls - pass through auth
    const internalHeaders: Record<string, string> = {}
    const cookie = request.headers.get('cookie')
    const apiKey = request.headers.get('x-api-key')
    if (cookie) internalHeaders['cookie'] = cookie
    if (apiKey) internalHeaders['x-api-key'] = apiKey

    // Get workflow state
    const stateResponse = await fetch(
      `${request.nextUrl.origin}/api/workflows/${workflowId}`,
      { headers: internalHeaders }
    )

    if (!stateResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch workflow state' }, { status: 500 })
    }

    const { data: workflowData } = await stateResponse.json()

    // Validate workflow for export compatibility
    const validationResult = validateWorkflowForExport(workflowData.state)
    if (!validationResult.valid) {
      return NextResponse.json(
        {
          error: 'Workflow contains unsupported features for export',
          unsupportedBlocks: validationResult.unsupportedBlocks,
          unsupportedProviders: validationResult.unsupportedProviders,
          message: validationResult.message,
        },
        { status: 400 }
      )
    }

    // Get workflow variables
    const variablesResponse = await fetch(
      `${request.nextUrl.origin}/api/workflows/${workflowId}/variables`,
      { headers: internalHeaders }
    )

    let workflowVariables: any[] = []
    if (variablesResponse.ok) {
      const varsData = await variablesResponse.json()
      workflowVariables = Object.values(varsData?.data || {}).map((v: any) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        value: v.value,
      }))
    }

    // Get decrypted environment variables
    const decryptedEnv = await getEffectiveDecryptedEnv(userId, workspaceId)

    // Build workflow.json - pre-transpile JavaScript to Python at export time
    const workflowState = preTranspileWorkflow(
      sanitizeForExport({
        ...workflowData.state,
        metadata: {
          name: workflowRow.name,
          description: workflowRow.description,
          exportedAt: new Date().toISOString(),
        },
        variables: workflowVariables,
      })
    )

    // Build .env file
    const envLines = [
      `# ${workflowRow.name} - Environment Variables`,
      '# Auto-generated with decrypted values',
      '',
      '# API Keys',
    ]

    // Add API keys from environment
    const apiKeyPatterns = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
    for (const key of apiKeyPatterns) {
      if (decryptedEnv[key]) {
        envLines.push(`${key}=${decryptedEnv[key]}`)
      }
    }

    // Add any other environment variables
    for (const [key, value] of Object.entries(decryptedEnv)) {
      if (!apiKeyPatterns.includes(key)) {
        envLines.push(`${key}=${value}`)
      }
    }

    // Add workflow variables
    envLines.push('')
    envLines.push('# Workflow Variables (initial values)')
    for (const variable of workflowVariables) {
      const value = typeof variable.value === 'object'
        ? JSON.stringify(variable.value)
        : variable.value
      envLines.push(`WORKFLOW_VAR_${variable.name}=${value}`)
    }

    envLines.push('')
    envLines.push('# Server Configuration')
    envLines.push('# HOST=0.0.0.0')
    envLines.push('# PORT=8080')
    envLines.push('# WORKFLOW_PATH=workflow.json')
    envLines.push('')

    // Create ZIP
    const zip = new JSZip()
    const serviceName = workflowRow.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const folder = zip.folder(serviceName)!

    // Add workflow.json
    folder.file('workflow.json', JSON.stringify(workflowState, null, 2))

    // Add .env
    folder.file('.env', envLines.join('\n'))

    // Add .env.example (masked)
    const envExampleLines = envLines.map(line => {
      if (line.includes('=') && !line.startsWith('#') && !line.startsWith('WORKFLOW_VAR_')) {
        const [key] = line.split('=')
        return `${key}=your-key-here`
      }
      return line
    })
    folder.file('.env.example', envExampleLines.join('\n'))

    // Add executor files
    for (const [filename, content] of Object.entries(EXECUTOR_FILES)) {
      folder.file(filename, content)
    }

    // Add USAGE.md
    folder.file('README.md', `# ${workflowRow.name}

Standalone workflow service exported from Sim Studio.

## Quick Start

\`\`\`bash
# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn main:app --port 8080

# Execute workflow
curl -X POST http://localhost:8080/execute \\
  -H "Content-Type: application/json" \\
  -d '{"your": "input"}'
\`\`\`

## Docker Deployment

\`\`\`bash
# Build and run with Docker Compose
docker compose up -d

# Or build manually
docker build -t ${serviceName} .
docker run -p 8080:8080 --env-file .env ${serviceName}
\`\`\`

## Files

- \`workflow.json\` - Workflow definition
- \`.env\` - Environment variables (API keys included)
- \`.env.example\` - Template without sensitive values
- \`main.py\` - FastAPI server
- \`executor.py\` - DAG execution engine
- \`handlers/\` - Block type handlers
- \`Dockerfile\` - Container configuration
- \`docker-compose.yml\` - Docker Compose setup

## API

- \`GET /health\` - Health check
- \`POST /execute\` - Execute workflow with input

## Security Notice

⚠️ **IMPORTANT**: The \`.env\` file contains sensitive API keys.

- **Never commit \`.env\` to version control** - add it to \`.gitignore\`
- Use \`.env.example\` as a template for team members
- In production, use secure environment variable management (e.g., AWS Secrets Manager, Docker secrets, Kubernetes secrets)
- Consider using environment-specific configurations for different deployments

## MCP Tool Support

This service supports MCP (Model Context Protocol) tools via the official Python SDK.
MCP servers must be running and accessible at their configured URLs for tool execution to work.

Exported at: ${new Date().toISOString()}
`)

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ type: 'nodebuffer' })

    logger.info('Exported workflow as service', {
      workflowId,
      serviceName,
      envVarsCount: Object.keys(decryptedEnv).length
    })

    return new NextResponse(zipBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${serviceName}-service.zip"`,
      },
    })

  } catch (error) {
    logger.error('Failed to export service:', error)
    return NextResponse.json(
      { error: 'Failed to export service' },
      { status: 500 }
    )
  }
}
