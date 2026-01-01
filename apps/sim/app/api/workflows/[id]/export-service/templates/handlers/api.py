"""API block handler - makes HTTP requests."""
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
        """
        Make an HTTP request.

        Inputs:
        - url: The URL to request
        - method: HTTP method (GET, POST, PUT, DELETE, PATCH)
        - headers: Dict or list of headers
        - body: Request body (for POST/PUT/PATCH)
        - params: Query parameters
        - timeout: Request timeout in seconds
        """
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
