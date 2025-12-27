"""Reference resolver for workflow block references."""
import re
from typing import Any, Dict, List, Union

class ReferenceResolver:
    # Pattern: <blockName.field> or <blockName["field"]> or <blockName["field"].subfield>
    # Supports both dot notation and bracket notation (with single or double quotes)
    REFERENCE_PATTERN = re.compile(
        r'<([a-zA-Z_][a-zA-Z0-9_]*'  # Block name
        r'(?:'
        r'\.[a-zA-Z_][a-zA-Z0-9_]*'  # .field (dot notation)
        r'|'
        r'\[["\'][^"\'\']+["\']\]'  # ["field"] or ['field'] (bracket notation)
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
