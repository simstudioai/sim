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
import { basename, join } from 'node:path'

/** Shells we can install prompt hooks into. */
export type SupportedShell = 'zsh' | 'bash'

export function detectShell(shellPath: string): SupportedShell | null {
  const name = basename(shellPath)
  if (name === 'zsh' || name === '-zsh') return 'zsh'
  if (name === 'bash' || name === '-bash') return 'bash'
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

/** Undoes the escaping applied by the shell hooks. */
function unescapeValue(value: string): string {
  return value.replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
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
  return $st
}

trap '__sim_preexec' DEBUG
PROMPT_COMMAND="__sim_precmd\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
`
  )
  return rcPath
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
