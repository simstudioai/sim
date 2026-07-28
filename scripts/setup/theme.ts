import chalk from 'chalk'

const BRAND = '#e6e6e6'

export const isRich = () => chalk.level > 0

export const theme = {
  accent: chalk.hex(BRAND),
  heading: chalk.bold.hex(BRAND),
  muted: chalk.hex('#8a8f98'),
  success: chalk.hex('#33c482'),
  warn: chalk.hex('#ffb020'),
  error: chalk.hex('#e23d2d'),
  command: chalk.hex(BRAND),
}

export const glyph = {
  pass: theme.success('✓'),
  warn: theme.warn('!'),
  fail: theme.error('✗'),
  skip: theme.muted('○'),
} as const

/** OSC 8 clickable terminal hyperlink; plain text when not a rich TTY. */
export function link(label: string, url: string): string {
  if (!isRich() || !process.stdout.isTTY) return `${label} (${url})`
  return `\x1b]8;;${url}\x1b\\${chalk.underline.hex(BRAND)(label)}\x1b]8;;\x1b\\`
}
