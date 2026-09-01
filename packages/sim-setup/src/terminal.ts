/** Resets colors, shows the cursor, and disables raw mode — called on every exit path. */
export function restoreTerminal(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[0m\x1b[?25h')
  }
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false)
  }
}

export function exitWith(code: number): never {
  restoreTerminal()
  process.exit(code)
}
