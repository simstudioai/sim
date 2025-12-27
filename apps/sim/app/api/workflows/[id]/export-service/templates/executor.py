"""DAG-based workflow executor with loop and condition support."""
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
    """Tracks state for a loop iteration."""
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
                    result[key] = '\n'.join(contents)
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
        """Build execution graph and identify loop children."""
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
        """Get topological order for a subset of blocks."""
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
        """Get blocks that are not children of any loop."""
        all_loop_children = set()
        for children in self.loop_children.values():
            all_loop_children.update(children)
        return set(self.blocks.keys()) - all_loop_children

    async def _execute_block(self, ctx: 'ExecutionContext', block: Block) -> Dict[str, Any]:
        """Execute a single block with retry logic."""
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
        """Execute a loop block and iterate over its children."""
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

            # Safe expression evaluation using ast instead of eval
            return self._safe_eval_condition(cond)
        except:
            return state.iteration < state.max_iterations

    def _safe_eval_condition(self, expr: str) -> bool:
        """Safely evaluate a simple boolean expression without using eval().

        Supports: comparisons (<, >, <=, >=, ==, !=), boolean operators (and, or, not),
        literals (numbers, strings, True, False, None), and len() function.
        """
        import ast
        import operator

        # Allowed operators
        ops = {
            ast.Eq: operator.eq,
            ast.NotEq: operator.ne,
            ast.Lt: operator.lt,
            ast.LtE: operator.le,
            ast.Gt: operator.gt,
            ast.GtE: operator.ge,
            ast.And: lambda a, b: a and b,
            ast.Or: lambda a, b: a or b,
            ast.Not: operator.not_,
            ast.Add: operator.add,
            ast.Sub: operator.sub,
        }

        def safe_eval_node(node):
            if isinstance(node, ast.Expression):
                return safe_eval_node(node.body)
            elif isinstance(node, ast.Constant):
                return node.value
            elif isinstance(node, ast.Num):  # Python 3.7 compatibility
                return node.n
            elif isinstance(node, ast.Str):  # Python 3.7 compatibility
                return node.s
            elif isinstance(node, ast.NameConstant):  # Python 3.7 compatibility
                return node.value
            elif isinstance(node, ast.Name):
                # Only allow True, False, None as names
                if node.id == 'True':
                    return True
                elif node.id == 'False':
                    return False
                elif node.id == 'None':
                    return None
                raise ValueError(f'Unsafe name: {node.id}')
            elif isinstance(node, ast.Compare):
                left = safe_eval_node(node.left)
                for op, comparator in zip(node.ops, node.comparators):
                    right = safe_eval_node(comparator)
                    if type(op) not in ops:
                        raise ValueError(f'Unsafe operator: {type(op).__name__}')
                    if not ops[type(op)](left, right):
                        return False
                    left = right
                return True
            elif isinstance(node, ast.BoolOp):
                values = [safe_eval_node(v) for v in node.values]
                if isinstance(node.op, ast.And):
                    return all(values)
                elif isinstance(node.op, ast.Or):
                    return any(values)
            elif isinstance(node, ast.UnaryOp):
                operand = safe_eval_node(node.operand)
                if isinstance(node.op, ast.Not):
                    return not operand
                elif isinstance(node.op, ast.USub):
                    return -operand
                raise ValueError(f'Unsafe unary operator: {type(node.op).__name__}')
            elif isinstance(node, ast.BinOp):
                left = safe_eval_node(node.left)
                right = safe_eval_node(node.right)
                if type(node.op) not in ops:
                    raise ValueError(f'Unsafe binary operator: {type(node.op).__name__}')
                return ops[type(node.op)](left, right)
            elif isinstance(node, ast.Call):
                # Only allow len() function
                if isinstance(node.func, ast.Name) and node.func.id == 'len':
                    if len(node.args) == 1:
                        arg = safe_eval_node(node.args[0])
                        return len(arg)
                raise ValueError(f'Unsafe function call')
            elif isinstance(node, ast.List):
                return [safe_eval_node(e) for e in node.elts]
            raise ValueError(f'Unsafe node type: {type(node).__name__}')

        try:
            tree = ast.parse(expr, mode='eval')
            return bool(safe_eval_node(tree))
        except Exception:
            # If parsing fails, default to False for safety
            return False

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
