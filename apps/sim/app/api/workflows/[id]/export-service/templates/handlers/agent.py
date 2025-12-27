"""Agent block handler - calls LLM APIs with MCP tool support."""
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

ENV_VAR_PATTERN = re.compile(r'\{\{([A-Z_][A-Z0-9_]*)\}\}')
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
    """Detect which provider to use based on model name."""
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
        """Prune old messages to prevent context overflow.

        Keeps the first message (original user request) and the most recent turns.
        """
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
        """Truncate large tool results to prevent memory exhaustion."""
        if len(result) <= MAX_TOOL_RESULT_SIZE:
            return result

        # Try to preserve JSON structure
        truncated = result[:MAX_TOOL_RESULT_SIZE]
        return truncated + f'\n... [truncated, {len(result) - MAX_TOOL_RESULT_SIZE} chars omitted]'

    def _get_api_key(self, inputs: Dict[str, Any], provider: str) -> Optional[str]:
        """Get API key for the specified provider."""
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

    def _get_native_file_tools(self) -> List[Dict]:
        """Get native file tool definitions if WORKSPACE_DIR is configured."""
        from tools import is_native_tools_enabled, get_workspace_info

        if not is_native_tools_enabled():
            return []

        workspace_info = get_workspace_info()
        workspace_dir = workspace_info.get('workspace_dir', './workspace')

        return [
            {
                'name': 'local_write_file',
                'description': f'Write content to a file in the local workspace ({workspace_dir}). Use this for saving outputs locally. Path is relative to workspace directory.',
                'input_schema': {
                    'type': 'object',
                    'properties': {
                        'path': {'type': 'string', 'description': 'File path relative to workspace directory'},
                        'content': {'type': 'string', 'description': 'Content to write to the file'}
                    },
                    'required': ['path', 'content']
                }
            },
            {
                'name': 'local_read_file',
                'description': f'Read content from a file in the local workspace ({workspace_dir}). Path is relative to workspace directory.',
                'input_schema': {
                    'type': 'object',
                    'properties': {
                        'path': {'type': 'string', 'description': 'File path relative to workspace directory'}
                    },
                    'required': ['path']
                }
            },
            {
                'name': 'local_list_directory',
                'description': f'List files and directories in the local workspace ({workspace_dir}). Path is relative to workspace directory.',
                'input_schema': {
                    'type': 'object',
                    'properties': {
                        'path': {'type': 'string', 'description': 'Directory path relative to workspace (default: root)', 'default': '.'}
                    },
                    'required': []
                }
            },
        ]

    def _build_tools(self, tools_config: List[Dict]) -> List[Dict]:
        """Build Claude tools from config and register for execution.

        Automatically includes native file tools if WORKSPACE_DIR is configured.
        """
        tools = []
        self.tool_registry = {}

        # Auto-register native file tools if WORKSPACE_DIR is set
        native_file_tools = self._get_native_file_tools()
        for tool in native_file_tools:
            tools.append(tool)
            self.tool_registry[tool['name']] = {
                'type': 'native',
                'name': tool['name'].replace('local_', '')  # Map local_write_file -> write_file
            }

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
                return '\n'.join(texts) if texts else json.dumps({'result': 'empty'})

            return json.dumps({'result': 'success', 'content': []})

        except asyncio.TimeoutError:
            return json.dumps({'error': f'MCP tool {tool_name} timed out after {timeout}s'})
        except ConnectionError as e:
            return json.dumps({'error': f'Cannot connect to MCP server at {server_url}: {str(e)}'})
        except Exception as e:
            return json.dumps({'error': f'MCP tool error: {str(e)}'})

    def _execute_native_tool(self, tool_info: Dict, tool_input: Dict) -> str:
        """Execute a native tool using local implementations."""
        from tools import write_file, read_file, execute_command, list_directory

        tool_name = tool_info['name']

        try:
            if tool_name == 'write_file':
                result = write_file(tool_input.get('path', ''), tool_input.get('content', ''))
            elif tool_name in ('read_file', 'read_text_file'):
                result = read_file(tool_input.get('path', ''))
            elif tool_name == 'list_directory':
                result = list_directory(tool_input.get('path', '.'))
            elif tool_name == 'execute_command':
                result = execute_command(tool_input.get('command', ''))
            else:
                result = {'error': f'Unknown native tool: {tool_name}'}

            return json.dumps(result)
        except Exception as e:
            return json.dumps({'error': str(e)})

    def _build_openai_tools(self, tools: List[Dict]) -> List[Dict]:
        """Convert tools to OpenAI format."""
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
        """Convert tools to Google Gemini format."""
        google_tools = []
        for tool in tools:
            google_tools.append({
                'name': tool['name'],
                'description': tool.get('description', ''),
                'parameters': tool.get('input_schema', {'type': 'object', 'properties': {}})
            })
        return google_tools

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Route to the appropriate provider based on model."""
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
        """Execute using Anthropic Claude API."""
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
        """Execute using OpenAI API."""
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
        """Execute using Google Gemini API."""
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
        """Parse JSON from response if format specified."""
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
