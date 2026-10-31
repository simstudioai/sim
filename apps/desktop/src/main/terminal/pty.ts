/**
 * The pseudo-terminal a shell runs in, with node-pty's platform differences kept here so the
 * session above it reads the same everywhere.
 *
 * On Windows the shell runs on the bundled ConPTY: the one built into Windows can deliver an OSC
 * marker ahead of the text written before it, so a command's output would land after its finish
 * marker. That build asks for the terminal's device attributes as it starts and holds the shell's
 * first output until it hears back, three seconds when nothing answers, so the pty answers that
 * one query itself, as xterm.js would, and keeps it from the output so the reply is never sent
 * twice; an agent's shell has no panel to answer it at all. node-pty there cannot send a signal
 * either, only end the shell.
 */
import { spawn } from '@lydell/node-pty'

const DEVICE_ATTRIBUTES_QUERY = '\u001b[c'
const DEVICE_ATTRIBUTES_REPLY = '\u001b[?1;2c'

/** How much of `data`'s end could be the start of the query, completed by the next chunk. */
function trailingQueryPrefixLength(data: string): number {
  for (
    let length = Math.min(DEVICE_ATTRIBUTES_QUERY.length - 1, data.length);
    length > 0;
    length--
  ) {
    if (DEVICE_ATTRIBUTES_QUERY.startsWith(data.slice(-length))) return length
  }
  return 0
}

interface TerminalPtyOptions {
  platform: NodeJS.Platform
  shellPath: string
  /** The shell's arguments; omitted, it starts as a login shell where the platform has one. */
  args?: string[]
  cols: number
  rows: number
  cwd: string
  env: NodeJS.ProcessEnv
}

/** A running shell's pseudo-terminal. */
export interface TerminalPty {
  readonly pid: number
  /** Output as the shell wrote it, less the startup query the pty answered. Register once. */
  onData(handler: (data: string) => void): void
  onExit(handler: () => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  /** Sends `signal` to the shell; on Windows, which has no signals, ends it. */
  kill(signal?: NodeJS.Signals): void
}

/** Spawns `options.shellPath` in a pseudo-terminal, set up for the platform it runs on. */
export function spawnTerminalPty(options: TerminalPtyOptions): TerminalPty {
  const windows = options.platform === 'win32'
  const pty = spawn(options.shellPath, options.args ?? (windows ? [] : ['-l']), {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
    ...(windows ? { useConptyDll: true } : {}),
  })

  let startupQueryPending = windows
  /** A chunk's tail that may be the query split across chunks, held until the next one. */
  let heldTail = ''
  const answerStartupQuery = (chunk: string): string => {
    const data = heldTail + chunk
    heldTail = ''
    const index = data.indexOf(DEVICE_ATTRIBUTES_QUERY)
    if (index === -1) {
      const held = trailingQueryPrefixLength(data)
      heldTail = data.slice(data.length - held)
      return data.slice(0, data.length - held)
    }
    startupQueryPending = false
    pty.write(DEVICE_ATTRIBUTES_REPLY)
    return data.slice(0, index) + data.slice(index + DEVICE_ATTRIBUTES_QUERY.length)
  }

  return {
    get pid() {
      return pty.pid
    },
    onData: (handler) => {
      pty.onData((chunk) => handler(startupQueryPending ? answerStartupQuery(chunk) : chunk))
    },
    onExit: (handler) => {
      pty.onExit(() => handler())
    },
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    pause: () => pty.pause(),
    resume: () => pty.resume(),
    kill: (signal) => (windows ? pty.kill() : pty.kill(signal)),
  }
}
