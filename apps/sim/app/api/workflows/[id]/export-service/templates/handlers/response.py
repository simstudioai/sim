"""Response block handler - formats final output."""
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
