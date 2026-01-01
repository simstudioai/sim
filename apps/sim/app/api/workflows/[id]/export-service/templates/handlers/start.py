"""Start block handler - receives workflow input."""
from typing import Any, Dict

class StartBlockHandler:
    def can_handle(self, block) -> bool:
        return block.type in ('start', 'start_trigger', 'starter')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        return ctx.inputs
