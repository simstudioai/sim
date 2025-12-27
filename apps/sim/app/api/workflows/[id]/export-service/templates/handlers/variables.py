"""Variables block handler - updates workflow variables."""
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
