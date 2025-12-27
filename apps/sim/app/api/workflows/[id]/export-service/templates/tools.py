"""Native file and shell tools for workflow execution.

These tools provide local filesystem access when WORKSPACE_DIR is configured.
If WORKSPACE_DIR is not set, these tools are disabled and return errors
directing users to use MCP filesystem tools instead.

Environment Variables:
    WORKSPACE_DIR: Path to sandbox directory for file operations.
                   If not set, native file tools are disabled.
    ENABLE_COMMAND_EXECUTION: Set to 'true' to enable the execute_command tool.
                              Disabled by default for security.
    MAX_FILE_SIZE: Maximum file size in bytes (default: 100MB).
"""
import base64
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

# Sandbox configuration - all file operations restricted to this directory
# None if not configured (native tools disabled)
_workspace_env = os.environ.get('WORKSPACE_DIR')
WORKSPACE_DIR: Optional[Path] = Path(_workspace_env).resolve() if _workspace_env else None

# Command execution opt-in (disabled by default for security)
COMMAND_EXECUTION_ENABLED = os.environ.get('ENABLE_COMMAND_EXECUTION', '').lower() == 'true'

# File size limit (default 100MB)
MAX_FILE_SIZE = int(os.environ.get('MAX_FILE_SIZE', 100 * 1024 * 1024))


def is_native_tools_enabled() -> bool:
    """Check if native file tools are enabled (WORKSPACE_DIR is set)."""
    return WORKSPACE_DIR is not None


def is_command_execution_enabled() -> bool:
    """Check if command execution is enabled."""
    return WORKSPACE_DIR is not None and COMMAND_EXECUTION_ENABLED


def get_workspace_info() -> Dict[str, Any]:
    """Get information about the workspace configuration."""
    if WORKSPACE_DIR:
        return {
            'enabled': True,
            'workspace_dir': str(WORKSPACE_DIR),
            'exists': WORKSPACE_DIR.exists(),
            'command_execution_enabled': COMMAND_EXECUTION_ENABLED,
            'max_file_size': MAX_FILE_SIZE,
        }
    return {
        'enabled': False,
        'message': 'WORKSPACE_DIR not set. Use MCP filesystem tools or set WORKSPACE_DIR in .env',
    }


def _check_enabled() -> Optional[Dict[str, Any]]:
    """Check if native tools are enabled. Returns error dict if disabled."""
    if not WORKSPACE_DIR:
        return {
            'success': False,
            'error': 'Native file tools disabled. Set WORKSPACE_DIR environment variable or use MCP filesystem tools.',
        }
    return None


def _ensure_workspace():
    """Ensure workspace directory exists."""
    if WORKSPACE_DIR:
        WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

def _safe_path(path: str) -> Path:
    """
    Resolve a path safely within the workspace sandbox.
    Raises ValueError if path escapes the sandbox.
    """
    _ensure_workspace()

    # Handle relative and absolute paths
    p = Path(path)
    if not p.is_absolute():
        p = WORKSPACE_DIR / p

    # Resolve to absolute path (resolves .., symlinks, etc.)
    resolved = p.resolve()

    # Check if path is within workspace
    try:
        resolved.relative_to(WORKSPACE_DIR)
    except ValueError:
        raise ValueError(f'Path escapes sandbox: {path} -> {resolved} is outside {WORKSPACE_DIR}')

    return resolved

def write_file(path: str, content: str) -> Dict[str, Any]:
    """Write text content to a file within the workspace sandbox."""
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        # Check content size
        content_bytes = content.encode('utf-8')
        if len(content_bytes) > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'Content exceeds maximum file size ({MAX_FILE_SIZE} bytes)'
            }

        p = _safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        # Return path relative to workspace for cleaner output
        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'path': str(rel_path), 'absolute_path': str(p), 'size': len(content_bytes)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def write_bytes(path: str, data: str, encoding: str = 'base64') -> Dict[str, Any]:
    """Write binary data to a file within the workspace sandbox.

    Args:
        path: File path relative to workspace
        data: Binary data encoded as string (base64 by default)
        encoding: Encoding format ('base64' or 'raw')
    """
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        # Decode data
        if encoding == 'base64':
            content_bytes = base64.b64decode(data)
        else:
            content_bytes = data.encode('utf-8')

        # Check content size
        if len(content_bytes) > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'Content exceeds maximum file size ({MAX_FILE_SIZE} bytes)'
            }

        p = _safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content_bytes)
        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'path': str(rel_path), 'absolute_path': str(p), 'size': len(content_bytes)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def append_file(path: str, content: str) -> Dict[str, Any]:
    """Append text content to a file within the workspace sandbox."""
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        p = _safe_path(path)

        # Check if appending would exceed max size
        current_size = p.stat().st_size if p.exists() else 0
        content_bytes = content.encode('utf-8')
        new_size = current_size + len(content_bytes)

        if new_size > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'Appending would exceed maximum file size ({MAX_FILE_SIZE} bytes). Current: {current_size}, adding: {len(content_bytes)}'
            }

        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, 'a', encoding='utf-8') as f:
            f.write(content)

        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'path': str(rel_path), 'absolute_path': str(p), 'new_size': new_size}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def read_file(path: str) -> Dict[str, Any]:
    """Read text content from a file within the workspace sandbox."""
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        p = _safe_path(path)

        # Check file size before reading
        file_size = p.stat().st_size
        if file_size > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'File exceeds maximum size ({MAX_FILE_SIZE} bytes). File is {file_size} bytes.'
            }

        content = p.read_text()
        return {'success': True, 'content': content, 'size': file_size}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except FileNotFoundError:
        return {'success': False, 'error': f'File not found: {path}'}
    except UnicodeDecodeError:
        return {'success': False, 'error': f'File is not valid UTF-8 text. Use read_bytes for binary files.'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def read_bytes(path: str, encoding: str = 'base64') -> Dict[str, Any]:
    """Read binary data from a file within the workspace sandbox.

    Args:
        path: File path relative to workspace
        encoding: Output encoding format ('base64' or 'raw')
    """
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        p = _safe_path(path)

        # Check file size before reading
        file_size = p.stat().st_size
        if file_size > MAX_FILE_SIZE:
            return {
                'success': False,
                'error': f'File exceeds maximum size ({MAX_FILE_SIZE} bytes). File is {file_size} bytes.'
            }

        content_bytes = p.read_bytes()

        if encoding == 'base64':
            data = base64.b64encode(content_bytes).decode('ascii')
        else:
            data = content_bytes.decode('utf-8', errors='replace')

        return {'success': True, 'data': data, 'encoding': encoding, 'size': file_size}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except FileNotFoundError:
        return {'success': False, 'error': f'File not found: {path}'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def delete_file(path: str) -> Dict[str, Any]:
    """Delete a file within the workspace sandbox."""
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        p = _safe_path(path)

        if not p.exists():
            return {'success': False, 'error': f'File not found: {path}'}

        if p.is_dir():
            return {'success': False, 'error': f'Cannot delete directory with delete_file. Path: {path}'}

        p.unlink()
        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'deleted': str(rel_path)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def execute_command(command: str, cwd: Optional[str] = None) -> Dict[str, Any]:
    """
    Execute a command within the workspace sandbox.

    For security, shell=True is never used. Commands are parsed with shlex
    and executed directly. Shell features (pipes, redirects, etc.) are not
    supported to prevent command injection.

    Args:
        command: The command to execute (simple command with arguments only)
        cwd: Working directory (must be within workspace, defaults to workspace root)
    """
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        _ensure_workspace()

        # Validate and set working directory
        if cwd:
            work_dir = _safe_path(cwd)
        else:
            work_dir = WORKSPACE_DIR

        # Detect shell features that indicate potential injection attempts
        # These are not supported for security reasons
        dangerous_chars = ['|', '>', '<', '&&', '||', ';', '$', '\`', '$(', '\${']
        for char in dangerous_chars:
            if char in command:
                return {
                    'success': False,
                    'error': f'Shell operators not supported for security. Found: {char}'
                }

        # Use safer non-shell mode with shlex parsing
        args = shlex.split(command)

        # Additional validation: reject empty commands
        if not args:
            return {'success': False, 'error': 'Empty command'}

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            cwd=str(work_dir),
            timeout=300
        )

        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode,
            'cwd': str(work_dir)
        }
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Command timed out after 300 seconds'}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def list_directory(path: str = '.') -> Dict[str, Any]:
    """List contents of a directory within the workspace sandbox.

    Returns file metadata including size and modification time.
    """
    disabled_error = _check_enabled()
    if disabled_error:
        return disabled_error
    try:
        from datetime import datetime

        p = _safe_path(path)

        if not p.exists():
            return {'success': False, 'error': f'Directory not found: {path}'}

        if not p.is_dir():
            return {'success': False, 'error': f'Not a directory: {path}'}

        entries = []
        for entry in p.iterdir():
            rel_path = entry.relative_to(WORKSPACE_DIR)
            stat = entry.stat()

            entry_info = {
                'name': entry.name,
                'type': 'directory' if entry.is_dir() else 'file',
                'path': str(rel_path),
                'size': stat.st_size,
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }

            # Add file extension for files
            if entry.is_file():
                entry_info['extension'] = entry.suffix.lstrip('.') if entry.suffix else None

            entries.append(entry_info)

        # Sort by name
        entries.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))

        return {'success': True, 'entries': entries, 'count': len(entries), 'workspace': str(WORKSPACE_DIR)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}
