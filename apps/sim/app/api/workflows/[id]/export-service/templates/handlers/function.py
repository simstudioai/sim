"""Function block handler - executes Python code (pre-transpiled at export time)."""
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
        """Resolve <block.field> references in code to Python literals."""
        # Pattern matches <blockName.field> or <blockName["field"]>
        pattern = re.compile(
            r'<([a-zA-Z_][a-zA-Z0-9_]*'
            r'(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[["\'][^"\'\']+["\']\])*'
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
                escaped = result.replace('\\', '\\\\').replace("'", "\\'")
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
