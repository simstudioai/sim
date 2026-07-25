import { sleep } from '@sim/utils/helpers'
import chalk from 'chalk'
import { restoreTerminal } from './terminal.ts'
import { isRich, theme } from './theme.ts'

const WORDMARK = ['      ▀       ', '▄▀▀▀  █  █▀█▀█', '▀▀▀▄  █  █ █ █', '▄▄▄▀  █  █ █ █'] as const
const TAGLINE = 'the AI workspace'
const WIDTH = Math.max(...WORDMARK.map((row) => row.length))
const EDGE = chalk.hex('#ffffff')
const SHELL = chalk.hex('#3d3d3d')
const FRAME_DELAY_MS = 35

function renderRow(row: string, edge: number): string {
  let out = ''
  for (let col = 0; col < row.length; col++) {
    const ch = row[col]
    if (ch === ' ') {
      out += ch
    } else if (col < edge - 1) {
      out += theme.accent(ch)
    } else if (col <= edge) {
      out += EDGE(ch)
    } else {
      out += SHELL(ch)
    }
  }
  return out
}

function paintFrame(edge: number, redraw: boolean): void {
  if (redraw) process.stdout.write(`\x1b[${WORDMARK.length + 1}F`)
  for (const row of WORDMARK) {
    process.stdout.write(`\x1b[K${renderRow(row, edge)}\n`)
  }
  process.stdout.write(`\x1b[K${theme.muted(TAGLINE)}\n`)
}

/** Animated half-block sim wordmark; degrades to a plain line off-TTY/CI. */
export async function showBanner(): Promise<void> {
  const animated =
    process.stdout.isTTY &&
    isRich() &&
    !process.env.CI &&
    !process.env.VITEST &&
    (process.stdout.columns ?? 80) >= WIDTH + 2

  console.log()
  if (!animated) {
    console.log(`◆ Sim — ${TAGLINE}`)
    console.log()
    return
  }

  const onSigint = () => {
    restoreTerminal()
    process.exit(130)
  }
  process.once('SIGINT', onSigint)
  process.stdout.write('\x1b[?25l')
  try {
    paintFrame(-2, false)
    for (let edge = 0; edge <= WIDTH + 2; edge++) {
      await sleep(FRAME_DELAY_MS)
      paintFrame(edge, true)
    }
  } finally {
    process.stdout.write('\x1b[?25h')
    process.removeListener('SIGINT', onSigint)
  }
  console.log()
}
