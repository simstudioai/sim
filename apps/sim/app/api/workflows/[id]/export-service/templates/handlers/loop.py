"""Loop block handler - executes loop iterations."""
import json
from typing import Any, Dict, List, Optional

MAX_LOOP_ITERATIONS = 1000  # Safety limit

class LoopScope:
    """Tracks loop execution state."""
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
        """
        Loop blocks are containers. The actual iteration is handled by the executor.
        This returns loop metadata for the executor to use.
        """
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
        """Resolve forEach items to a list."""
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
        """Evaluate a loop condition."""
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

        # Safely evaluate the condition using AST instead of eval
        try:
            return self._safe_eval_condition(eval_condition)
        except Exception as e:
            # On error, check iteration limit
            return scope.iteration < scope.max_iterations

    def _safe_eval_condition(self, expr: str) -> bool:
        """Safely evaluate a simple boolean expression without using eval()."""
        import ast
        import operator

        ops = {
            ast.Eq: operator.eq, ast.NotEq: operator.ne,
            ast.Lt: operator.lt, ast.LtE: operator.le,
            ast.Gt: operator.gt, ast.GtE: operator.ge,
            ast.Add: operator.add, ast.Sub: operator.sub,
        }

        def safe_eval_node(node):
            if isinstance(node, ast.Expression):
                return safe_eval_node(node.body)
            elif isinstance(node, ast.Constant):
                return node.value
            elif isinstance(node, ast.Num):
                return node.n
            elif isinstance(node, ast.Str):
                return node.s
            elif isinstance(node, ast.NameConstant):
                return node.value
            elif isinstance(node, ast.Name):
                if node.id in ('True', 'False', 'None'):
                    return {'True': True, 'False': False, 'None': None}[node.id]
                raise ValueError(f'Unsafe name: {node.id}')
            elif isinstance(node, ast.Compare):
                left = safe_eval_node(node.left)
                for op, comp in zip(node.ops, node.comparators):
                    right = safe_eval_node(comp)
                    if type(op) not in ops:
                        raise ValueError(f'Unsafe operator')
                    if not ops[type(op)](left, right):
                        return False
                    left = right
                return True
            elif isinstance(node, ast.BoolOp):
                values = [safe_eval_node(v) for v in node.values]
                return all(values) if isinstance(node.op, ast.And) else any(values)
            elif isinstance(node, ast.UnaryOp):
                operand = safe_eval_node(node.operand)
                if isinstance(node.op, ast.Not):
                    return not operand
                if isinstance(node.op, ast.USub):
                    return -operand
                raise ValueError(f'Unsafe unary operator')
            elif isinstance(node, ast.BinOp):
                left, right = safe_eval_node(node.left), safe_eval_node(node.right)
                if type(node.op) not in ops:
                    raise ValueError(f'Unsafe binary operator')
                return ops[type(node.op)](left, right)
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id == 'len' and len(node.args) == 1:
                    return len(safe_eval_node(node.args[0]))
                raise ValueError(f'Unsafe function call')
            elif isinstance(node, ast.List):
                return [safe_eval_node(e) for e in node.elts]
            raise ValueError(f'Unsafe node type: {type(node).__name__}')

        tree = ast.parse(expr, mode='eval')
        return bool(safe_eval_node(tree))

    def should_continue(self, scope: LoopScope, ctx) -> bool:
        """Check if loop should continue to next iteration."""
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
        """Move to next iteration."""
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
        """Get final aggregated results after loop completes."""
        # Include any remaining outputs from last iteration
        if scope.current_iteration_outputs:
            scope.iteration_outputs.append(list(scope.current_iteration_outputs.values()))

        return {
            'results': scope.iteration_outputs,
            'totalIterations': scope.iteration,
            'status': 'loop_completed'
        }
