"""Condition/Router block handler - evaluates conditions and controls flow."""
import json
from typing import Any, Dict, List, Optional
from resolver import ReferenceResolver

class ConditionBlockHandler:
    def __init__(self):
        self.resolver = ReferenceResolver()

    def can_handle(self, block) -> bool:
        return block.type in ('condition', 'router', 'if', 'switch')

    async def execute(self, ctx, block, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluate conditions and return which branch to take.

        Supports multiple condition formats:
        - Simple condition: { condition: 'x > 5' }
        - Multiple routes: { routes: [{condition: '...', target: '...'}, ...] }
        - If/else: { if: '...', then: '...', else: '...' }
        """
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
        """Safely evaluate a condition."""
        # Already a boolean
        if isinstance(condition, bool):
            return condition

        # Falsy values
        if condition is None or condition == '' or condition == 0:
            return False

        # Truthy non-string values
        if not isinstance(condition, str):
            return bool(condition)

        # String conditions - evaluate safely using AST
        try:
            # Build evaluation context with block outputs
            eval_context = {
                'start': ctx.inputs,
                'variable': ctx.workflow_variables,
                **ctx.block_outputs
            }

            return self._safe_eval_with_context(condition, eval_context)
        except Exception as e:
            # On error, treat as false
            return False

    def _safe_eval_with_context(self, expr: str, context: Dict[str, Any]) -> bool:
        """Safely evaluate expression with variable context using AST."""
        import ast
        import operator

        ops = {
            ast.Eq: operator.eq, ast.NotEq: operator.ne,
            ast.Lt: operator.lt, ast.LtE: operator.le,
            ast.Gt: operator.gt, ast.GtE: operator.ge,
            ast.Add: operator.add, ast.Sub: operator.sub,
            ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
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
                # Allow True/False/None and context variables
                if node.id == 'True':
                    return True
                elif node.id == 'False':
                    return False
                elif node.id == 'None':
                    return None
                elif node.id in context:
                    return context[node.id]
                raise ValueError(f'Unknown variable: {node.id}')
            elif isinstance(node, ast.Subscript):
                # Handle dict/list access like start['field'] or arr[0]
                value = safe_eval_node(node.value)
                if isinstance(node.slice, ast.Index):  # Python 3.8
                    key = safe_eval_node(node.slice.value)
                else:
                    key = safe_eval_node(node.slice)
                if isinstance(value, dict):
                    return value.get(key)
                elif isinstance(value, (list, tuple)) and isinstance(key, int):
                    return value[key] if 0 <= key < len(value) else None
                return None
            elif isinstance(node, ast.Attribute):
                # Handle attribute access like obj.field
                value = safe_eval_node(node.value)
                if isinstance(value, dict):
                    return value.get(node.attr)
                return getattr(value, node.attr, None)
            elif isinstance(node, ast.Compare):
                left = safe_eval_node(node.left)
                for op, comp in zip(node.ops, node.comparators):
                    right = safe_eval_node(comp)
                    if type(op) not in ops:
                        raise ValueError(f'Unsafe operator: {type(op).__name__}')
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
                # Only allow len(), str(), int(), bool()
                if isinstance(node.func, ast.Name) and node.func.id in ('len', 'str', 'int', 'bool') and len(node.args) == 1:
                    arg = safe_eval_node(node.args[0])
                    return {'len': len, 'str': str, 'int': int, 'bool': bool}[node.func.id](arg)
                raise ValueError(f'Unsafe function call')
            elif isinstance(node, ast.List):
                return [safe_eval_node(e) for e in node.elts]
            elif isinstance(node, ast.Dict):
                return {safe_eval_node(k): safe_eval_node(v) for k, v in zip(node.keys, node.values)}
            raise ValueError(f'Unsafe node type: {type(node).__name__}')

        tree = ast.parse(expr, mode='eval')
        return bool(safe_eval_node(tree))
