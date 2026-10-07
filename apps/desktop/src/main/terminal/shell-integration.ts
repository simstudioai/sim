/**
 * Shell integration: the mechanism that turns an opaque byte stream into
 * structured commands.
 *
 * Writing `npm test\r` into a PTY tells you nothing about where that command's
 * output begins, when it ends, or what it exited with. The fix, pioneered by
 * FinalTerm and standardised in practice by VS Code, is to have the shell
 * itself announce those boundaries with OSC escape sequences emitted from its
 * prompt hooks. We speak VS Code's `OSC 633` grammar because it is the
 * best-tested variant and its semantics are documented.
 *
 * Every sequence carries a per-session nonce. This is a security requirement,
 * not decoration: the terminal renders untrusted bytes, so `cat` of a file
 * containing a literal `\e]633;D;0\a` would otherwise let arbitrary file
 * content forge "the command finished successfully" and feed the agent a
 * fabricated exit code. Markers whose nonce does not match are ignored.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Shells we can install prompt hooks into. */
export type SupportedShell = 'zsh' | 'bash' | 'powershell'

export function detectShell(shellPath: string): SupportedShell | null {
  // Split on both separators rather than basename(): a Windows path must
  // resolve the same way on the macOS machines that run the test suite.
  const name = (shellPath.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (name === 'zsh' || name === '-zsh') return 'zsh'
  if (name === 'bash' || name === '-bash') return 'bash'
  if (name === 'pwsh' || name === 'powershell') return 'powershell'
  return null
}

export function createNonce(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Marker kinds we act on. `A` (prompt start) doubles as the "integration is
 * live" signal; `C`/`D` bracket a command's output; `E` reports the exact
 * command line; `P` tracks the working directory across `cd`.
 */
export type ShellMarker =
  | { kind: 'prompt-start' }
  | { kind: 'command-line'; command: string }
  | { kind: 'output-start' }
  | { kind: 'output-end'; exitCode: number }
  | { kind: 'cwd'; cwd: string }

export interface ParseResult {
  /** Stream with the OSC 633 sequences removed, safe to hand to xterm.js. */
  text: string
  markers: ShellMarker[]
}

/**
 * Undoes the escaping applied by the shell hooks: `\\` for a backslash and
 * `\xHH` for separators. One pass, so an escaped backslash followed by `x3b`
 * is not mistaken for an escaped semicolon.
 */
function unescapeValue(value: string): string {
  return value.replace(/\\\\|\\x([0-9a-fA-F]{2})/g, (_match, hex: string | undefined) =>
    hex === undefined ? '\\' : String.fromCharCode(Number.parseInt(hex, 16))
  )
}

/**
 * Incremental parser. PTY chunks split escape sequences at arbitrary byte
 * offsets, so a partial trailing sequence is held back until the rest arrives
 * rather than being emitted as garbage or mis-parsed.
 */
export class ShellIntegrationParser {
  private pending = ''

  constructor(private readonly nonce: string) {}

  /**
   * Cap on a held-back partial sequence. A stream containing a bare `\e]` that
   * never terminates would otherwise grow `pending` without bound; past this
   * length we accept that it was not a marker and release it.
   */
  private static readonly MAX_PENDING = 8192

  parse(chunk: string): ParseResult {
    const buffer = this.pending + chunk
    this.pending = ''

    const markers: ShellMarker[] = []
    let text = ''
    let index = 0

    while (index < buffer.length) {
      const start = buffer.indexOf('\u001b]633;', index)
      if (start === -1) {
        text += buffer.slice(index)
        break
      }
      text += buffer.slice(index, start)

      const terminator = findTerminator(buffer, start)
      if (terminator === null) {
        // Incomplete sequence: hold it for the next chunk unless it has grown
        // implausibly long, in which case treat it as ordinary text.
        const tail = buffer.slice(start)
        if (tail.length > ShellIntegrationParser.MAX_PENDING) {
          text += tail
        } else {
          this.pending = tail
        }
        break
      }

      const body = buffer.slice(start + '\u001b]633;'.length, terminator.index)
      const marker = this.toMarker(body)
      if (marker) markers.push(marker)
      index = terminator.index + terminator.length
    }

    return { text, markers }
  }

  private toMarker(body: string): ShellMarker | null {
    const parts = body.split(';')
    const kind = parts[0]

    // The nonce is always last. Without a match the sequence did not come from
    // our prompt hooks, so it is untrusted output that must not be acted on.
    const nonce = parts[parts.length - 1]
    if (nonce !== this.nonce) return null

    switch (kind) {
      case 'A':
        return { kind: 'prompt-start' }
      case 'C':
        return { kind: 'output-start' }
      case 'D': {
        const exitCode = Number.parseInt(parts[1] ?? '', 10)
        return { kind: 'output-end', exitCode: Number.isFinite(exitCode) ? exitCode : 0 }
      }
      case 'E':
        return { kind: 'command-line', command: unescapeValue(parts.slice(1, -1).join(';')) }
      case 'P': {
        const value = parts.slice(1, -1).join(';')
        if (!value.startsWith('Cwd=')) return null
        return { kind: 'cwd', cwd: unescapeValue(value.slice('Cwd='.length)) }
      }
      default:
        return null
    }
  }
}

/** OSC sequences end with BEL or ST; both appear in the wild. */
function findTerminator(buffer: string, from: number): { index: number; length: number } | null {
  const bel = buffer.indexOf('\u0007', from)
  const st = buffer.indexOf('\u001b\\', from)
  if (bel !== -1 && (st === -1 || bel < st)) return { index: bel, length: 1 }
  if (st !== -1) return { index: st, length: 2 }
  return null
}

/**
 * zsh reads all of its startup files from `ZDOTDIR`, so pointing that at a
 * generated directory is the only hook that works for login *and* interactive
 * shells. Each generated file sources the user's real one first, so their
 * prompt, aliases, and PATH win over ours.
 */
function writeZshFiles(dir: string, nonce: string, originalZdotdir: string): void {
  const sourceOriginal = (file: string) =>
    `[ -f "$SIM_ZDOTDIR_ORIG/${file}" ] && builtin source "$SIM_ZDOTDIR_ORIG/${file}"`

  writeFileSync(
    join(dir, '.zshenv'),
    `SIM_ZDOTDIR_ORIG="\${SIM_ZDOTDIR_ORIG:-${originalZdotdir}}"\n${sourceOriginal('.zshenv')}\n`
  )
  writeFileSync(join(dir, '.zprofile'), `${sourceOriginal('.zprofile')}\n`)
  writeFileSync(join(dir, '.zlogin'), `${sourceOriginal('.zlogin')}\n`)

  writeFileSync(
    join(dir, '.zshrc'),
    `${sourceOriginal('.zshrc')}

# Restore ZDOTDIR so anything the user's config spawns behaves normally.
ZDOTDIR="$SIM_ZDOTDIR_ORIG"

__sim_nonce='${nonce}'
__sim_in_cmd=''

__sim_esc() {
  local s=\${1//\\\\/\\\\\\\\}
  s=\${s//;/\\\\x3b}
  s=\${s//$'\\n'/\\\\x0a}
  builtin printf '%s' "$s"
}

__sim_preexec() {
  __sim_in_cmd=1
  builtin printf '\\e]633;E;%s;%s\\a' "$(__sim_esc "$1")" "$__sim_nonce"
  builtin printf '\\e]633;C;%s\\a' "$__sim_nonce"
}

__sim_precmd() {
  local st=$?
  # Cwd is reported before the finish marker so a \`cd\` is already visible by
  # the time the command's result is resolved.
  builtin printf '\\e]633;P;Cwd=%s;%s\\a' "$(__sim_esc "$PWD")" "$__sim_nonce"
  if [ -n "$__sim_in_cmd" ]; then
    builtin printf '\\e]633;D;%s;%s\\a' "$st" "$__sim_nonce"
  fi
  __sim_in_cmd=''
  builtin printf '\\e]633;A;%s\\a' "$__sim_nonce"
}

# zsh appends this marker when output does not end in a newline. It is display
# noise that would otherwise be captured as part of a command's output.
PROMPT_EOL_MARK=''

autoload -Uz add-zsh-hook
add-zsh-hook preexec __sim_preexec
add-zsh-hook precmd __sim_precmd
`
  )
}

/**
 * bash has no preexec hook, so command start is detected with a DEBUG trap and
 * command end from PROMPT_COMMAND. The trap fires once per command in a
 * pipeline, hence the in-command latch.
 */
function writeBashFile(dir: string, nonce: string): string {
  const rcPath = join(dir, 'sim-bash-rc.sh')
  writeFileSync(
    rcPath,
    `[ -f "$HOME/.bashrc" ] && builtin source "$HOME/.bashrc"

__sim_nonce='${nonce}'
__sim_in_cmd=''

__sim_esc() {
  local s=\${1//\\\\/\\\\\\\\}
  s=\${s//;/\\\\x3b}
  s=\${s//$'\\n'/\\\\x0a}
  builtin printf '%s' "$s"
}

__sim_preexec() {
  case "$BASH_COMMAND" in __sim_*) return ;; esac
  [ -n "$__sim_in_cmd" ] && return
  __sim_in_cmd=1
  builtin printf '\\e]633;E;%s;%s\\a' "$(__sim_esc "$BASH_COMMAND")" "$__sim_nonce"
  builtin printf '\\e]633;C;%s\\a' "$__sim_nonce"
}

# Git for Windows' bash reports /c/Users/... paths; the host, and the rest of
# the app, speak C:\\Users\\..., so the directory is translated when cygpath
# is there to do it.
__sim_cwd() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$PWD"; else builtin printf '%s' "$PWD"; fi
}

__sim_precmd() {
  local st=$?
  # Cwd is reported before the finish marker so a \`cd\` is already visible by
  # the time the command's result is resolved.
  builtin printf '\\e]633;P;Cwd=%s;%s\\a' "$(__sim_esc "$(__sim_cwd)")" "$__sim_nonce"
  if [ -n "$__sim_in_cmd" ]; then
    builtin printf '\\e]633;D;%s;%s\\a' "$st" "$__sim_nonce"
  fi
  __sim_in_cmd=''
  builtin printf '\\e]633;A;%s\\a' "$__sim_nonce"
  return $st
}

trap '__sim_preexec' DEBUG
PROMPT_COMMAND="__sim_precmd\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
`
  )
  return rcPath
}

/**
 * PowerShell has no preexec hook either, and its `prompt` is a plain function
 * the host calls. The host also calls `PSConsoleHostReadLine` to read each
 * line, so wrapping that yields the exact command text (E) and the moment it
 * starts (C), while `prompt` reports the directory (P), the result of the
 * previous command (D) and the new prompt (A). This is the arrangement
 * Windows Terminal and VS Code use.
 *
 * The script is handed over as `-EncodedCommand` rather than a file: dot
 * sourcing a file is subject to the machine's execution policy, which blocks
 * scripts outright on a stock Windows client, and lowering that policy for
 * the shell would loosen it for everything the user runs there too.
 */
function powerShellScript(nonce: string): string {
  return `
$global:__simNonce = '${nonce}'
$global:__simInCmd = $false
$global:__simOriginalPrompt = $function:prompt

function global:__simEscape([string]$Value) {
  return $Value.Replace('\\', '\\\\').Replace(';', '\\x3b').Replace([string][char]13, '').Replace([string][char]10, '\\x0a')
}

function global:__simMarker([string]$Body) {
  return [string][char]27 + ']633;' + $Body + ';' + $global:__simNonce + [string][char]7
}

function global:prompt {
  $succeeded = $?
  $code = if ($succeeded) { 0 } elseif ($global:LASTEXITCODE) { [int]$global:LASTEXITCODE } else { 1 }
  $location = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath
  $out = __simMarker ('P;Cwd=' + (__simEscape $location))
  if ($global:__simInCmd) {
    $out += __simMarker ('D;' + $code)
    $global:__simInCmd = $false
  }
  $original = $null
  if ($global:__simOriginalPrompt) {
    try { $original = [string](& $global:__simOriginalPrompt) } catch { $original = $null }
  }
  if (-not $original) { $original = 'PS ' + $location + '> ' }
  return $out + (__simMarker 'A') + $original
}

function global:PSConsoleHostReadLine {
  $line = $null
  if (Get-Module PSReadLine) {
    # The two-argument overload only: in PSReadLine 2.0 (Windows PowerShell
    # 5.1) the third parameter is a CancellationToken, and a bool coerces to
    # a cancelled one, so that call returns at once and the prompt loops.
    $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($Host.Runspace, $ExecutionContext)
  } else {
    $line = $Host.UI.ReadLine()
  }
  if ($line -and $line.Trim()) {
    $global:__simInCmd = $true
    [Console]::Write((__simMarker ('E;' + (__simEscape $line))) + (__simMarker 'C'))
  }
  return $line
}

# The agent clears a half-typed line with Ctrl-U before each command, which
# PSReadLine's default Windows key map leaves unbound.
if (Get-Module PSReadLine) {
  Set-PSReadLineKeyHandler -Chord Ctrl+u -Function BackwardDeleteLine -ErrorAction SilentlyContinue
}
`
}

export interface ShellLaunch {
  args: string[]
  env: Record<string, string>
}

/**
 * Generates the startup files for `shell` inside `dir` and returns the
 * arguments and environment overrides needed to make it load them.
 */
export function buildShellLaunch(
  shell: SupportedShell,
  dir: string,
  nonce: string,
  env: Record<string, string>
): ShellLaunch {
  mkdirSync(dir, { recursive: true })

  if (shell === 'powershell') {
    // Profiles still load (no -NoProfile), so the user's aliases and prompt
    // come first and ours wraps theirs.
    const encoded = Buffer.from(powerShellScript(nonce), 'utf16le').toString('base64')
    return { args: ['-NoLogo', '-NoExit', '-EncodedCommand', encoded], env: {} }
  }

  if (shell === 'zsh') {
    writeZshFiles(dir, nonce, env.ZDOTDIR || env.HOME || '')
    return {
      args: ['-l'],
      env: { ZDOTDIR: dir, SIM_ZDOTDIR_ORIG: env.ZDOTDIR || env.HOME || '' },
    }
  }

  const rcPath = writeBashFile(dir, nonce)
  // `--init-file` is honoured only by interactive non-login bash, so the login
  // flag is deliberately omitted here; the generated file sources ~/.bashrc.
  return { args: ['--init-file', rcPath, '-i'], env: {} }
}
