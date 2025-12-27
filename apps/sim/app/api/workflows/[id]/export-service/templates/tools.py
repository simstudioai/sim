"""Native file and shell tools for workflow execution."""
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

# Sandbox configuration - all file operations restricted to this directory
WORKSPACE_DIR = Path(os.environ.get('WORKSPACE_DIR', './workspace')).resolve()

def _ensure_workspace():
    """Ensure workspace directory exists."""
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
    try:
        p = _safe_path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        # Return path relative to workspace for cleaner output
        rel_path = p.relative_to(WORKSPACE_DIR)
        return {'success': True, 'path': str(rel_path), 'absolute_path': str(p)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def read_file(path: str) -> Dict[str, Any]:
    try:
        p = _safe_path(path)
        content = p.read_text()
        return {'success': True, 'content': content}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except FileNotFoundError:
        return {'success': False, 'error': f'File not found: {path}'}
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
    try:
        p = _safe_path(path)
        entries = []
        for entry in p.iterdir():
            rel_path = entry.relative_to(WORKSPACE_DIR)
            entries.append({
                'name': entry.name,
                'type': 'directory' if entry.is_dir() else 'file',
                'path': str(rel_path)
            })
        return {'success': True, 'entries': entries, 'workspace': str(WORKSPACE_DIR)}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
    except Exception as e:
        return {'success': False, 'error': str(e)}
