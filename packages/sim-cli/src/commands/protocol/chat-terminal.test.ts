import { PassThrough } from 'node:stream'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { describe, expect, it, vi } from 'vitest'
import { ReadlineChatTerminal } from './chat-terminal.js'

interface TTYInput extends PassThrough {
  isTTY: boolean
  isRaw: boolean
  setRawMode: ReturnType<typeof vi.fn<(mode: boolean) => void>>
}

interface TTYOutput extends PassThrough {
  isTTY: boolean
  columns: number
  rows: number
}

function terminalStreams(
  columns = 80,
  rows = 24
): {
  input: TTYInput
  output: TTYOutput
  chunks: string[]
} {
  const input = new PassThrough() as TTYInput
  input.isTTY = true
  input.isRaw = false
  input.setRawMode = vi.fn((mode: boolean) => {
    input.isRaw = mode
  })

  const output = new PassThrough() as TTYOutput
  output.isTTY = true
  output.columns = columns
  output.rows = rows
  const chunks: string[] = []
  output.on('data', (chunk) => chunks.push(String(chunk)))
  return { input, output, chunks }
}

function key(input: TTYInput, character: string, value: Record<string, unknown>): void {
  input.emit('keypress', character, value)
}

function mirrorToHeadless(
  output: TTYOutput,
  columns: number,
  rows: number
): { terminal: HeadlessTerminal; flush: () => Promise<void> } {
  const terminal = new HeadlessTerminal({ cols: columns, rows, allowProposedApi: true })
  let writes = Promise.resolve()
  output.on('data', (chunk) => {
    writes = writes.then(
      () => new Promise<void>((resolve) => terminal.write(String(chunk), resolve))
    )
  })
  return { terminal, flush: () => writes }
}

function paintedPayloads(frame: string): string[] {
  const starts = [...frame.matchAll(/\u001b\[\d+;1H\u001b\[2K/gu)]
  return starts.map((start, index) => {
    const contentStart = (start.index ?? 0) + start[0].length
    const nextPaint = starts[index + 1]?.index ?? frame.length
    const remainder = frame.slice(contentStart, nextPaint)
    const nextControl = remainder.search(/\u001b\[\d+;\d+H|\u001b\[\?25[hl]|\u001b\[\?2026l/u)
    return remainder.slice(0, nextControl < 0 ? remainder.length : nextControl)
  })
}

function payloadDisplayWidth(value: string): number {
  const plain = value.replace(/\u001b\[[0-9;:]*m/gu, '')
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let width = 0
  for (const { segment } of segmenter.segment(plain)) {
    if (/^\p{Mark}+$/u.test(segment)) continue
    const codePoint = segment.codePointAt(0) ?? 0
    const wide =
      segment.includes('\u200d') ||
      /\p{Extended_Pictographic}/u.test(segment) ||
      (codePoint >= 0x1100 &&
        (codePoint <= 0x115f ||
          (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
          (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
          (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
          (codePoint >= 0xff00 && codePoint <= 0xff60) ||
          (codePoint >= 0x1f300 && codePoint <= 0x1faff)))
    width += wide ? 2 : 1
  }
  return width
}

function plainTerminalText(value: string): string {
  return value.replace(/\u001b\[[0-9;:]*m/gu, '')
}

function visibleTerminalLines(terminal: HeadlessTerminal, rows: number): string[] {
  return Array.from(
    { length: rows },
    (_, row) =>
      terminal.buffer.active
        .getLine(row)
        ?.translateToString(true)
        .replace(/\u00a0/gu, ' ')
        .trimEnd() ?? ''
  )
}

function expectUserPanelRow(terminal: HeadlessTerminal, row: number, columns: number): void {
  const line = terminal.buffer.active.getLine(row)
  expect(line).toBeDefined()
  expect(line?.getCell(0)?.isBgDefault()).toBe(true)
  for (let column = 1; column < columns - 2; column += 1) {
    const cell = line?.getCell(column)
    expect(cell?.isBgRGB()).toBe(true)
    expect(cell?.getBgColor()).toBe(0x3a3c46)
  }
  expect(line?.getCell(columns - 2)?.isBgDefault()).toBe(true)
  expect(line?.getCell(columns - 1)?.isBgDefault()).toBe(true)
}

describe('ReadlineChatTerminal', () => {
  it('opens with the active chat and switch hint, then reflows for narrow terminals', () => {
    const { input, output, chunks } = terminalStreams(80, 16)
    const terminal = new ReadlineChatTerminal(input, output)

    terminal.welcome({ chatTitle: 'New chat\u001b]0;owned\u0007' })

    const wideFrame = chunks.at(-1) ?? ''
    expect(wideFrame).toContain('\u001b[97m')
    expect(wideFrame).toContain('⠤⠶⠶⠮⣤⣽⠤⠴⡋  ⢘⡦⠤⢤⡏   ⠹⣄⣀⣀⡴⠋⠉⢹⢺⡄')
    expect(wideFrame).toContain('    ⠈⠓⠤⢄⣹⡤⠤⢜   ⠳⣄⣀⣀⡞   ⢙⣦⣖⠾⠋')
    expect(wideFrame).not.toContain('▐██▄███████████▌')
    expect(wideFrame).not.toContain('\u001b[38;2;128;47;222m')
    expect(wideFrame).toContain('\u001b[1mSim Chat\u001b[0m')
    expect(wideFrame).toContain('╭')
    expect(wideFrame).toContain('╰')
    expect(wideFrame).toContain('chat:    New chat')
    expect(wideFrame).not.toContain('workspace')
    expect(wideFrame).not.toContain('owned')
    const welcomeRows = paintedPayloads(wideFrame).map(plainTerminalText)
    expect(welcomeRows.findIndex((row) => row.includes('profile:'))).toBe(
      welcomeRows.findIndex((row) => row.includes('Sim Chat')) + 1
    )

    terminal.setChatTitle('Release investigation')
    expect(chunks.at(-1) ?? '').toContain('chat:    Release investigation')

    output.columns = 30
    output.emit('resize')
    const narrowFrame = chunks.at(-1) ?? ''
    expect(narrowFrame).toContain('         ⠈⠉⠉⣝⣀⣀⣚⣀⡔⠒⠛⠓⠊⠉⠉')
    expect(narrowFrame).not.toContain('▐██▄███████████▌')
    expect(narrowFrame).toContain('Sim Chat')
    expect(narrowFrame).toContain('chat Release investigation')
    expect(narrowFrame).not.toContain('ws_local')
    expect(narrowFrame).not.toContain('╭')
    terminal.close()
  })

  it('pins a balanced padded composer to the bottom of an alternate-screen viewport', async () => {
    const columns = 80
    const rows = 14
    const { input, output, chunks } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.read('❯ ')

    input.write('hello')
    await screen.flush()

    const buffer = screen.terminal.buffer.active
    const lines = visibleTerminalLines(screen.terminal, rows)
    expect(lines[rows - 3]).toBe(' ❯ hello')
    expect(lines[rows - 1]).toBe('')
    for (const row of [rows - 4, rows - 3, rows - 2]) {
      expectUserPanelRow(screen.terminal, row, columns)
    }
    expect(
      buffer
        .getLine(rows - 3)
        ?.getCell(0)
        ?.getChars()
    ).toBe(' ')
    expect(
      buffer
        .getLine(rows - 3)
        ?.getCell(1)
        ?.getChars()
    ).toBe('❯')
    expect(
      buffer
        .getLine(rows - 3)
        ?.getCell(1)
        ?.getFgColor()
    ).toBe(0xa0a0a0)
    expect(
      buffer
        .getLine(rows - 3)
        ?.getCell(3)
        ?.getFgColor()
    ).toBe(0xf2f2f2)
    expect(
      buffer
        .getLine(rows - 3)
        ?.getCell(columns - 3)
        ?.getChars()
    ).toBe(' ')
    expect(
      buffer
        .getLine(rows - 1)
        ?.getCell(0)
        ?.isBgDefault()
    ).toBe(true)
    expect(buffer.cursorY).toBe(rows - 3)
    expect(buffer.cursorX).toBe(8)

    input.write('\r')

    await expect(result).resolves.toEqual({ kind: 'line', value: 'hello' })
    const rendered = chunks.join('')
    expect(rendered).toContain('\u001b[?1049h')

    terminal.close()
    await screen.flush()
    expect(chunks.join('')).toContain('\u001b[?1049l')
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
    expect(input.isPaused()).toBe(true)
    screen.terminal.dispose()
  })

  it('submits an exact slash command with one Enter', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.read('❯ ')

    input.write('/exit\r')

    await expect(result).resolves.toEqual({ kind: 'line', value: '/exit' })
    terminal.close()
  })

  it('keeps the composer background continuous across a highlighted mention', async () => {
    const columns = 50
    const rows = 12
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:workflow-1',
          value: 'Release',
          displayText: 'Release',
          context: {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: 'Release',
          },
        },
      ],
      slash: [],
    })
    void terminal.read('❯ ')

    input.write('@rel\tthen')
    await screen.flush()

    const composerRow = visibleTerminalLines(screen.terminal, rows).findIndex((line) =>
      line?.startsWith(' ❯ @Release then')
    )
    expect(composerRow).toBeGreaterThanOrEqual(0)
    expectUserPanelRow(screen.terminal, composerRow, columns)
    expect(screen.terminal.buffer.active.getLine(composerRow)?.getCell(3)?.isFgRGB()).toBe(true)
    expect(screen.terminal.buffer.active.getLine(composerRow)?.getCell(12)?.getFgColor()).toBe(
      0xf2f2f2
    )
    expect(screen.terminal.buffer.active.getLine(composerRow)?.getCell(12)?.isFgRGB()).toBe(true)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('submits the exact resource identity selected from @ with literal client text', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:workflow-1',
          value: 'Release notes',
          displayText: 'Release notes',
          context: {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: 'Release notes',
          },
        },
      ],
      slash: [],
    })
    const result = terminal.read('❯ ')

    input.write('@rel\t\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: '@Release notes ',
      contexts: [
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          label: 'Release notes',
        },
      ],
    })
    terminal.close()
  })

  it('sanitizes server-provided suggestion text before rendering or submitting it', async () => {
    const { input, output, chunks } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const injected = '\u001b]2;suggestion-owned\u0007'
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:workflow-1',
          value: `Release${injected}\nnotes`,
          displayText: `Release${injected}\nnotes`,
          description: `workflow${injected}`,
          context: {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: `Release${injected}\nnotes`,
          },
        },
      ],
      slash: [],
    })
    const result = terminal.read('❯ ')

    input.write('@rel\t\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: '@Release notes ',
      contexts: [
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          label: 'Release notes',
        },
      ],
    })
    expect(chunks.join('')).not.toContain('suggestion-owned')
    terminal.close()
  })

  it('clips long suggestion labels before the description column', () => {
    const { input, output } = terminalStreams(50, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'logs:execution-1',
          value: 'x'.repeat(80),
          displayText: 'x'.repeat(80),
          description: 'log',
          tag: 'logs',
          context: {
            kind: 'logs',
            executionId: 'execution-1',
            label: 'x'.repeat(80),
          },
        },
      ],
      slash: [],
    })
    void terminal.read('❯ ')
    input.write('@')

    const probe = terminal as never as { buildPanel(rows: number): { lines: string[] } }
    const row = probe
      .buildPanel(14)
      .lines.find((line) => line.replace(/\u001b\[[0-9;:]*m/gu, '').includes('log'))
    expect(row?.replace(/\u001b\[[0-9;:]*m/gu, '')).toMatch(/… {2}log/u)
    terminal.close()
  })

  it('shows recent logs at the top level after the other @ resources', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:workflow-1',
          value: 'Release workflow',
          displayText: 'Release workflow',
          tag: 'workflow',
          context: {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: 'Release workflow',
          },
        },
        {
          id: 'logs:execution-1',
          value: 'Incident run',
          displayText: 'Incident run',
          description: 'log',
          tag: 'logs',
          context: {
            kind: 'logs',
            executionId: 'execution-1',
            label: 'Incident run',
          },
        },
      ],
      slash: [],
    })
    const result = terminal.read('❯ ')
    const probe = terminal as never as { buildPanel(rows: number): { lines: string[] } }

    input.write('@')
    const bare = probe.buildPanel(14).lines.map((line) => line.replace(/\u001b\[[0-9;:]*m/gu, ''))
    const workflowRow = bare.findIndex((line) => line.includes('Release workflow'))
    const logRow = bare.findIndex((line) => line.includes('Incident run'))
    expect(workflowRow).toBeGreaterThanOrEqual(0)
    expect(logRow).toBeGreaterThan(workflowRow)
    expect(bare.some((line) => line.includes('logs/'))).toBe(false)

    key(input, '', { name: 'down', sequence: '\u001b[B' })
    input.write('\t\r')
    await expect(result).resolves.toMatchObject({
      kind: 'line',
      value: '@Incident run ',
      contexts: [
        {
          kind: 'logs',
          executionId: 'execution-1',
          label: 'Incident run',
        },
      ],
    })
    terminal.close()
  })

  it('reopens @ suggestions after the trigger is removed and retyped', () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:workflow-1',
          value: 'Release workflow',
          displayText: 'Release workflow',
          context: {
            kind: 'workflow',
            workflowId: 'workflow-1',
            label: 'Release workflow',
          },
        },
      ],
      slash: [],
    })
    void terminal.read('❯ ')
    const probe = terminal as never as { buildPanel(rows: number): { lines: string[] } }
    const hasReleaseSuggestion = () =>
      probe
        .buildPanel(14)
        .lines.map(plainTerminalText)
        .some((line) => line.includes('Release workflow'))

    input.write('@')
    expect(hasReleaseSuggestion()).toBe(true)

    key(input, '', { name: 'escape', sequence: '\u001b' })
    expect(hasReleaseSuggestion()).toBe(false)
    key(input, '\u007f', { name: 'backspace', sequence: '\u007f' })
    input.write('@')

    expect(hasReleaseSuggestion()).toBe(true)
    terminal.close()
  })

  it('renders suggestions above the status and bottom-pinned composer', async () => {
    const columns = 80
    const rows = 14
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    const probe = terminal as never as {
      buildPanel(rows: number): { lines: string[]; cursor?: { row: number } }
    }
    const closedPanel = probe.buildPanel(rows)
    const closedCursorRow = rows - closedPanel.lines.length + (closedPanel.cursor?.row ?? 0)

    input.write('/')
    const panel = probe.buildPanel(rows)
    const lines = panel.lines.map((line) => line.replace(/\u001b\[[0-9;:]*m/gu, ''))
    const suggestion = lines.findIndex((line) => line.includes('/help'))
    const thinking = lines.findIndex((line) => line.includes('Thinking…'))
    const composer = lines.findIndex((line) => line.startsWith(' ❯'))
    const openCursorRow = rows - panel.lines.length + (panel.cursor?.row ?? 0)

    expect(suggestion).toBeGreaterThanOrEqual(0)
    expect(thinking).toBeGreaterThan(suggestion)
    expect(thinking).toBe(composer - 3)
    expect(lines[composer - 2]).toBe('')
    expect(lines[composer - 1]).toBe(' ')
    expect(lines[composer + 1]).toBe(' ')
    expect(composer + 1).toBe(lines.length - 2)
    expect(panel.cursor?.row).toBe(composer)
    expect(openCursorRow).toBe(closedCursorRow)
    expect(lines.at(-1)).toContain('enter to steer · esc to interrupt')

    await screen.flush()
    const renderedLines = visibleTerminalLines(screen.terminal, rows)
    const renderedThinking = renderedLines.findIndex((line) => line?.includes('Thinking…'))
    const renderedComposer = renderedLines.findIndex((line) => line?.startsWith(' ❯ /'))
    expect(renderedThinking).toBeGreaterThanOrEqual(0)
    expect(renderedComposer).toBe(renderedThinking + 3)
    expectUserPanelRow(screen.terminal, renderedComposer - 1, columns)
    expectUserPanelRow(screen.terminal, renderedComposer, columns)
    expectUserPanelRow(screen.terminal, renderedComposer + 1, columns)
    expect(screen.terminal.buffer.active.cursorY).toBe(renderedComposer)

    activity.stop()
    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('keeps autocomplete inactive when the terminal is too short to show an option', async () => {
    const { input, output } = terminalStreams(80, 4)
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.read('❯ ')

    input.write('/r\r')

    await expect(result).resolves.toEqual({ kind: 'line', value: '/r' })
    terminal.close()
  })

  it('filters a single-choice menu above a fixed bottom search composer', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const selected = terminal.select({
      prompt: 'Choose a chat',
      options: [
        { id: 'new', label: 'New chat', description: 'start blank' },
        { id: 'release', label: 'Release investigation', description: 'pinned' },
        { id: 'deploy', label: 'Deployment failure', description: 'updated yesterday' },
      ],
    })
    const probe = terminal as never as {
      buildPanel(rows: number): { lines: string[]; cursor?: { row: number } }
    }
    const initial = probe.buildPanel(14)
    const initialCursorRow = 14 - initial.lines.length + (initial.cursor?.row ?? 0)

    input.write('deploy')
    const filtered = probe.buildPanel(14)
    const lines = filtered.lines.map((line) => line.replace(/\u001b\[[0-9;:]*m/gu, ''))
    const filteredCursorRow = 14 - filtered.lines.length + (filtered.cursor?.row ?? 0)

    expect(lines.some((line) => line.includes('Deployment failure'))).toBe(true)
    expect(lines.some((line) => line.includes('Release investigation'))).toBe(false)
    const searchRow = lines.indexOf(' Search › deploy')
    expect(lines.findIndex((line) => line.includes('Deployment failure'))).toBeLessThan(searchRow)
    expect(lines[searchRow - 1]).toBe(' ')
    expect(lines[searchRow + 1]).toBe(' ')
    expect(lines.some((line) => line.startsWith('─'))).toBe(false)
    expect(filteredCursorRow).toBe(initialCursorRow)

    input.write('\r')
    await expect(selected).resolves.toEqual({ kind: 'selected', id: 'deploy' })
    terminal.close()
  })

  it('keeps chat options beyond the first hundred searchable', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const selected = terminal.select({
      prompt: 'Choose a chat',
      options: Array.from({ length: 150 }, (_, index) => ({
        id: `chat-${index + 1}`,
        label: index === 149 ? 'Needle investigation' : `Chat ${index + 1}`,
      })),
    })

    input.write('needle\r')

    await expect(selected).resolves.toEqual({ kind: 'selected', id: 'chat-150' })
    terminal.close()
  })

  it('clears prior transcript content without rebuilding the terminal viewport', () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.userMessage('Old question')
    terminal.write('Old answer\n')

    terminal.clearTranscript()

    expect((terminal as never as { transcript: string }).transcript).toBe('')
    terminal.userMessage('New question')
    expect((terminal as never as { transcript: string }).transcript).toContain('New question')
    expect((terminal as never as { transcript: string }).transcript).not.toContain('Old question')
    terminal.close()
  })

  it('opens / after whitespace and carries a selected skill identity', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [],
      slash: [
        {
          id: 'skill:skill-1',
          value: 'review',
          displayText: '/review',
          tag: 'skill',
          context: { kind: 'skill', skillId: 'skill-1', label: 'review' },
        },
      ],
    })
    const result = terminal.read('❯ ')

    input.write('please /rev\tthis\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: 'please /review this',
      contexts: [{ kind: 'skill', skillId: 'skill-1', label: 'review' }],
    })
    terminal.close()
  })

  it('resets autocomplete selection to the first match when the token query changes', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: ['Apple', 'Apricot', 'Banana'].map((label, index) => ({
        id: `workflow:${index}`,
        value: label,
        displayText: label,
        context: {
          kind: 'workflow' as const,
          workflowId: `workflow-${index}`,
          label,
        },
      })),
      slash: [],
    })
    const result = terminal.read('❯ ')

    input.write('@')
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    input.write('a\t\r')

    await expect(result).resolves.toMatchObject({
      kind: 'line',
      value: '@Apple ',
      contexts: [
        {
          kind: 'workflow',
          workflowId: 'workflow-0',
          label: 'Apple',
        },
      ],
    })
    terminal.close()
  })

  it('preserves the highlighted autocomplete item when async candidates arrive', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const tables = ['Customers', 'Orders'].map((label, index) => ({
      id: `table:${index}`,
      value: label,
      displayText: label,
      context: {
        kind: 'table' as const,
        tableId: `table-${index}`,
        label,
      },
    }))
    terminal.setSuggestionCandidates({ resources: tables, slash: [] })
    const result = terminal.read('❯ ')

    input.write('@')
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    terminal.setSuggestionCandidates({
      resources: [
        {
          id: 'workflow:0',
          value: 'Billing',
          displayText: 'Billing',
          context: {
            kind: 'workflow',
            workflowId: 'workflow-0',
            label: 'Billing',
          },
        },
        ...tables,
      ],
      slash: [],
    })
    input.write('\t\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: '@Orders ',
      contexts: [
        {
          kind: 'table',
          tableId: 'table-1',
          label: 'Orders',
        },
      ],
    })
    terminal.close()
  })

  it('auto-resolves a manually typed slash tag with skill precedence', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.setSuggestionCandidates({
      resources: [],
      slash: [
        {
          id: 'skill:skill-1',
          value: 'review',
          displayText: '/review',
          tag: 'skill',
          context: { kind: 'skill', skillId: 'skill-1', label: 'review' },
        },
        {
          id: 'mcp:mcp-1',
          value: 'review',
          displayText: '/review',
          tag: 'mcp',
          context: { kind: 'mcp', serverId: 'mcp-1', label: 'review' },
        },
      ],
    })
    const result = terminal.read('❯ ')

    input.write('/REVIEW this\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: '/REVIEW this',
      contexts: [{ kind: 'skill', skillId: 'skill-1', label: 'review' }],
    })
    terminal.close()
  })

  it('preserves selected context identity through a queued priority preload', async () => {
    const { input, output } = terminalStreams(80, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const contexts = [{ kind: 'workflow' as const, workflowId: 'workflow-1', label: 'Release' }]

    expect(terminal.preload('@Release', { queued: true, contexts })).toBe(true)
    const result = terminal.read('❯ ')
    input.write('\r')

    await expect(result).resolves.toEqual({
      kind: 'line',
      value: '@Release',
      queued: true,
      display: '@Release',
      contexts,
    })
    terminal.close()
  })

  it('leaves a caller-owned flowing input flowing after close', () => {
    const { input, output } = terminalStreams(80, 14)
    input.resume()
    expect(input.readableFlowing).toBe(true)

    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    terminal.close()

    expect(input.isPaused()).toBe(false)
  })

  it('does not change caller-owned raw mode when closed before opening the viewport', () => {
    const { input, output } = terminalStreams(80, 14)
    input.isRaw = true

    const terminal = new ReadlineChatTerminal(input, output)
    terminal.close()

    expect(input.setRawMode).not.toHaveBeenCalled()
  })

  it('commits sent prompts with the same balanced panel as the composer', async () => {
    const columns = 80
    const rows = 14
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.read('❯ ')

    input.write('first line\\\rsecond line\r')
    await expect(result).resolves.toEqual({ kind: 'line', value: 'first line\nsecond line' })
    await screen.flush()

    const buffer = screen.terminal.buffer.active
    const lines = visibleTerminalLines(screen.terminal, rows)
    const firstRow = lines.indexOf(' ❯ first line')
    const secondRow = lines.indexOf('   second line')
    expect(firstRow).toBeGreaterThan(0)
    expect(secondRow).toBe(firstRow + 1)
    for (const row of [firstRow - 1, firstRow, secondRow, secondRow + 1]) {
      expectUserPanelRow(screen.terminal, row, columns)
    }
    expect(buffer.getLine(firstRow)?.getCell(0)?.getChars()).toBe(' ')
    expect(buffer.getLine(firstRow)?.getCell(1)?.getChars()).toBe('❯')
    expect(buffer.getLine(firstRow)?.getCell(1)?.getFgColor()).toBe(0xa0a0a0)
    expect(
      buffer
        .getLine(firstRow)
        ?.getCell(columns - 3)
        ?.getChars()
    ).toBe(' ')
    expect(
      buffer
        .getLine(secondRow + 2)
        ?.getCell(0)
        ?.isBgDefault()
    ).toBe(true)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('wraps committed user-card words within the shaded content width', async () => {
    const columns = 21
    const rows = 14
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.read('❯ ')

    input.write('abcdef 1234567890\r')
    await expect(result).resolves.toEqual({ kind: 'line', value: 'abcdef 1234567890' })
    await screen.flush()

    const lines = visibleTerminalLines(screen.terminal, rows)
    const firstRow = lines.indexOf(' ❯ abcdef')
    expect(firstRow).toBeGreaterThan(0)
    expect(lines[firstRow + 1]).toBe('   1234567890')
    expectUserPanelRow(screen.terminal, firstRow, columns)
    expectUserPanelRow(screen.terminal, firstRow + 1, columns)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('renders padded user-turn cells while keeping the composer in the physical bottom rows', async () => {
    const columns = 67
    const rows = 12
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    terminal.welcome({ chatTitle: 'New chat' })
    const submitted = terminal.read('❯ ')

    input.write('whats in my workspace\r')
    await expect(submitted).resolves.toEqual({
      kind: 'line',
      value: 'whats in my workspace',
    })
    const activity = terminal.activity('Thinking…')
    activity.clear()
    terminal.write('Here is your workspace.')
    activity.complete()
    void terminal.read('❯ ')
    await screen.flush()

    const buffer = screen.terminal.buffer.active
    const lines = visibleTerminalLines(screen.terminal, rows)
    expect(lines).toContain(' ❯ whats in my workspace')
    expect(lines).toContain('● Here is your workspace.')
    expect(lines).toContain('✻ Worked for 1s')
    expect(lines[rows - 3]).toBe(' ❯')
    expect(lines[rows - 2]).toBe('')
    expect(lines[11]).toBe('  ? for shortcuts')
    expectUserPanelRow(screen.terminal, rows - 4, columns)
    expectUserPanelRow(screen.terminal, rows - 3, columns)
    expectUserPanelRow(screen.terminal, rows - 2, columns)

    const userRowIndex = lines.indexOf(' ❯ whats in my workspace')
    const assistantRowIndex = lines.indexOf('● Here is your workspace.')
    expectUserPanelRow(screen.terminal, userRowIndex - 1, columns)
    expectUserPanelRow(screen.terminal, userRowIndex, columns)
    expectUserPanelRow(screen.terminal, userRowIndex + 1, columns)
    expect(
      buffer
        .getLine(userRowIndex + 2)
        ?.getCell(0)
        ?.isBgDefault()
    ).toBe(true)
    expect(buffer.getLine(assistantRowIndex)?.getCell(0)?.getChars()).toBe('●')
    expect(buffer.getLine(assistantRowIndex)?.getCell(0)?.isBgDefault()).toBe(true)
    expect(buffer.cursorY).toBe(rows - 3)
    expect(buffer.baseY).toBe(0)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('expands user and composer panels across wide terminal viewports', async () => {
    const columns = 240
    const rows = 14
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const submitted = terminal.read('❯ ')

    input.write('wide terminal\r')
    await expect(submitted).resolves.toEqual({ kind: 'line', value: 'wide terminal' })
    void terminal.read('❯ ')
    await screen.flush()

    const buffer = screen.terminal.buffer.active
    expectUserPanelRow(screen.terminal, 0, columns)
    expectUserPanelRow(screen.terminal, 1, columns)
    expectUserPanelRow(screen.terminal, 2, columns)
    expectUserPanelRow(screen.terminal, rows - 4, columns)
    expectUserPanelRow(screen.terminal, rows - 3, columns)
    expectUserPanelRow(screen.terminal, rows - 2, columns)
    expect(
      buffer
        .getLine(0)
        ?.getCell(columns - 3)
        ?.getChars()
    ).toBe(' ')
    expect(
      buffer
        .getLine(rows - 1)
        ?.getCell(0)
        ?.isBgDefault()
    ).toBe(true)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('buffers and removes leading whitespace so assistant text shares the prefix row', async () => {
    const { input, output, chunks } = terminalStreams(30, 10)
    const screen = mirrorToHeadless(output, 30, 10)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    terminal.userMessage('question')
    const chunksBeforeWhitespace = chunks.length

    terminal.write('\u001b[1m')
    terminal.write('\n  ')
    expect(chunks).toHaveLength(chunksBeforeWhitespace)

    terminal.write('answer\u001b[0m')
    await screen.flush()
    const answerFrame = chunks.at(-1) ?? ''
    expect(answerFrame).toContain('● \u001b[1manswer\u001b[0m')
    expect(answerFrame).not.toContain('● \u001b[0m')
    const visibleLines = Array.from({ length: 10 }, (_, row) =>
      screen.terminal.buffer.active.getLine(row)?.translateToString(true).trimEnd()
    ).filter(Boolean)
    expect(visibleLines).toContain('● answer')
    expect(visibleLines).not.toContain('●')
    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('keeps explicit and soft-wrapped assistant rows in a hanging gutter', async () => {
    const columns = 16
    const rows = 14
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    terminal.userMessage('question')
    const activity = terminal.activity('Thinking…')
    activity.clear()

    terminal.write('alpha beta gamma delta\n')
    terminal.write('\u001b[1mHeading\u001b[0m\n')
    terminal.write('\u001b[2m•\u001b[0m nested item')

    await screen.flush()
    const visibleLines = Array.from({ length: rows }, (_, row) =>
      screen.terminal.buffer.active.getLine(row)?.translateToString(true).trimEnd()
    )
    expect(visibleLines).toContain('● alpha beta')
    expect(visibleLines).toContain('  gamma delta')
    expect(visibleLines).toContain('  Heading')
    expect(visibleLines).toContain('  • nested item')
    expect(visibleLines).not.toContain('Heading')
    expect(visibleLines).not.toContain('• nested item')

    activity.stop()
    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('starts an assistant turn for attachment-only requests without a text prompt', () => {
    const { input, output, chunks } = terminalStreams(30, 10)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    activity.clear()
    terminal.write('I inspected the attachment.')

    expect(chunks.at(-1)).toContain('● I inspected the attachment.')
    activity.stop()
    terminal.close()
  })

  it('coordinates streaming transcript writes without moving the busy composer from the bottom', async () => {
    const columns = 50
    const rows = 12
    const { input, output, chunks } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    const submitted = terminal.read('❯ ')
    input.write('question\r')
    await submitted
    const activity = terminal.activity('Thinking…')
    activity.clear()

    terminal.write('Hello ')
    terminal.write('\u001b[1mworld\u001b[0m')
    await screen.flush()

    const latestFrame = chunks.at(-1) ?? ''
    const rendered = chunks.join('')
    expect(latestFrame).toContain('Hello \u001b[1mworld\u001b[0m')
    expect(rendered).toContain('esc to interrupt')
    expect(latestFrame).not.toContain('\u001b[2J')
    expect(latestFrame).not.toContain('\n')
    expectUserPanelRow(screen.terminal, rows - 4, columns)
    expectUserPanelRow(screen.terminal, rows - 3, columns)
    expectUserPanelRow(screen.terminal, rows - 2, columns)
    expect(visibleTerminalLines(screen.terminal, rows)[rows - 3]).toBe(' ❯')
    expect(screen.terminal.buffer.active.cursorY).toBe(rows - 3)

    activity.stop()
    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('keeps the busy composer editable and drains steering prompts in FIFO order', async () => {
    const { input, output, chunks } = terminalStreams(60, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const initial = terminal.read('❯ ')
    input.write('original request\r')
    await initial

    const interruptions: string[] = []
    terminal.onInterrupt((reason) => interruptions.push(reason))
    const activity = terminal.activity('Thinking…')

    input.write('first steer')
    await new Promise((resolve) => setImmediate(resolve))
    expect(plainTerminalText(chunks.at(-1) ?? '')).toContain(' ❯ first steer')
    expect(chunks.at(-1)).toContain('\u001b[?25h')

    input.write('\rsecond steer\r')
    await new Promise((resolve) => setImmediate(resolve))
    expect(interruptions).toEqual(['submit', 'submit'])
    expect(chunks.at(-1)).toContain('2 queued · enter to steer · esc to interrupt')

    activity.stop()
    await expect(terminal.read('❯ ')).resolves.toEqual({
      kind: 'line',
      value: 'first steer',
      queued: true,
      display: 'first steer',
    })
    await expect(terminal.read('❯ ')).resolves.toEqual({
      kind: 'line',
      value: 'second steer',
      queued: true,
      display: 'second steer',
    })
    terminal.close()
  })

  it('treats blank busy Enter as a no-op', async () => {
    const { input, output, chunks } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const interruptions: string[] = []
    terminal.onInterrupt((reason) => interruptions.push(reason))
    const activity = terminal.activity('Thinking…')

    key(input, '\r', { name: 'return', sequence: '\r' })

    expect(interruptions).toEqual([])
    expect((terminal as never as { queued: unknown[] }).queued).toHaveLength(0)
    expect(chunks.at(-1)).not.toContain('queued')
    activity.stop()
    terminal.close()
  })

  it('reports busy submissions without duplicating chat command or path semantics', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const interruptions: string[] = []
    terminal.onInterrupt((reason) => interruptions.push(reason))
    const activity = terminal.activity('Thinking…')

    input.write('/help \r/private/tmp/report.txt\r')
    await new Promise((resolve) => setImmediate(resolve))

    expect(interruptions).toEqual(['submit', 'submit'])
    activity.stop()
    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: '/help ', queued: true })
    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      value: '/private/tmp/report.txt',
      queued: true,
    })
    terminal.close()
  })

  it('prioritizes an explicit preload without losing queued turns or the live draft', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    input.write('/private/tmp/report.txt\rinspect it\runfinished')
    await new Promise((resolve) => setImmediate(resolve))
    activity.stop()

    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      value: '/private/tmp/report.txt',
      queued: true,
    })
    expect(terminal.preload('/attach "/private/tmp/report.txt"')).toBe(true)
    const confirmation = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(confirmation).resolves.toEqual({
      kind: 'line',
      value: '/attach "/private/tmp/report.txt"',
    })

    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      value: 'inspect it',
      queued: true,
    })
    const restoredDraft = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(restoredDraft).resolves.toEqual({ kind: 'line', value: 'unfinished' })
    terminal.close()
  })

  it('consumes a preload submitted while clipboard work is between reads', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    input.write('live draft')
    activity.stop()

    expect(terminal.preload('/attach "/private/tmp/report.txt"')).toBe(true)
    const clipboard = terminal.read('❯ ')
    key(input, '\u0016', { ctrl: true, name: 'v', sequence: '\u0016' })
    await expect(clipboard).resolves.toEqual({
      kind: 'clipboard',
      value: '/attach "/private/tmp/report.txt"',
    })

    // Clipboard inspection is asynchronous in chat.ts. Enter can arrive before
    // it asks the terminal for another input, and must consume this preload.
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      kind: 'line',
      value: '/attach "/private/tmp/report.txt"',
      queued: true,
    })

    const restoredDraft = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(restoredDraft).resolves.toEqual({ kind: 'line', value: 'live draft' })
    terminal.close()
  })

  it('preserves a large pasted draft while a priority preload is submitted', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const pasted = 'p'.repeat(900)
    const activity = terminal.activity('Thinking…')
    input.write('before ')
    key(input, '', { name: 'paste-start', sequence: '\u001b[200~' })
    key(input, pasted, { sequence: pasted })
    key(input, '', { name: 'paste-end', sequence: '\u001b[201~' })
    activity.stop()

    expect(terminal.preload('/attach "/private/tmp/report.txt"')).toBe(true)
    const confirmation = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(confirmation).resolves.toMatchObject({
      kind: 'line',
      value: '/attach "/private/tmp/report.txt"',
    })

    const restoredDraft = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(restoredDraft).resolves.toMatchObject({
      kind: 'line',
      value: `before ${pasted}`,
    })
    terminal.close()
  })

  it('retains queued paste bodies across later input and a priority retry', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const pasted = 'q'.repeat(900)
    const activity = terminal.activity('Thinking…')
    key(input, '', { name: 'paste-start', sequence: '\u001b[200~' })
    key(input, pasted, { sequence: pasted })
    key(input, '', { name: 'paste-end', sequence: '\u001b[201~' })
    key(input, '\r', { name: 'return', sequence: '\r' })
    activity.stop()

    const queued = await terminal.read('❯ ')
    expect(queued).toMatchObject({ kind: 'line', value: pasted, queued: true })
    if (queued.kind !== 'line' || !queued.display) throw new Error('Expected queued pasted line')

    const laterActivity = terminal.activity('Thinking…')
    input.write('later\r')
    laterActivity.stop()
    expect(terminal.preload(queued.display, { queued: true, pastes: queued.pastes })).toBe(true)

    const retry = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(retry).resolves.toMatchObject({ kind: 'line', value: pasted, queued: true })
    terminal.close()
  })

  it('keeps a deferred retry ahead of queued turns without duplicating its transcript row', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    input.write('retry me\r')
    activity.stop()

    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: 'retry me', queued: true })
    const laterActivity = terminal.activity('Thinking…')
    input.write('later\r')
    laterActivity.stop()
    expect(terminal.preload('retry me', { queued: true })).toBe(true)

    const clipboard = terminal.read('❯ ')
    key(input, '\u0016', { ctrl: true, name: 'v', sequence: '\u0016' })
    await expect(clipboard).resolves.toMatchObject({ kind: 'clipboard' })

    // Enter can land before clipboard inspection asks for the next input. The
    // retry remains the priority item even though another turn is queued.
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      value: 'retry me',
      queued: true,
    })
    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: 'later', queued: true })

    const transcript = (terminal as never as { transcript: string }).transcript
    expect(transcript.match(/retry me/gu)).toHaveLength(1)
    terminal.close()
  })

  it('retries a normally submitted prompt without duplicating its transcript row', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const firstAttempt = terminal.read('❯ ')
    input.write('retry me\r')
    await expect(firstAttempt).resolves.toEqual({ kind: 'line', value: 'retry me' })

    const activity = terminal.activity('Thinking…')
    activity.stop()
    expect(terminal.preload('retry me', { queued: true })).toBe(true)
    const retry = terminal.read('❯ ')
    input.write('\r')

    await expect(retry).resolves.toMatchObject({
      kind: 'line',
      value: 'retry me',
      queued: true,
    })
    const transcript = (terminal as never as { transcript: string }).transcript
    expect(transcript.match(/retry me/gu)).toHaveLength(1)
    terminal.close()
  })

  it('keeps an unchanged committed retry deduplicated after queue recall', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    input.write('retry me\r')
    activity.stop()

    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: 'retry me', queued: true })
    expect(terminal.preload('retry me', { queued: true })).toBe(true)
    key(input, '\r', { name: 'return', sequence: '\r' })
    key(input, '', { name: 'up', sequence: '\u001b[A' })
    key(input, '\r', { name: 'return', sequence: '\r' })

    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: 'retry me', queued: true })
    const transcript = (terminal as never as { transcript: string }).transcript
    expect(transcript.match(/retry me/gu)).toHaveLength(1)
    terminal.close()
  })

  it('keeps clipboard draft edits terminal-owned while a turn is active', async () => {
    const { input, output, chunks } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    input.write('draft')
    key(input, '\u0016', { ctrl: true, name: 'v', sequence: '\u0016' })
    for (let index = 0; index < 5; index += 1) {
      key(input, '\u007f', { name: 'backspace', sequence: '\u007f' })
    }
    expect(chunks.at(-1)).not.toContain('queued')
    activity.stop()

    await expect(terminal.read('❯ ')).resolves.toEqual({ kind: 'clipboard', value: 'draft' })
    const empty = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(empty).resolves.toEqual({ kind: 'line', value: '' })
    terminal.close()
  })

  it('dismisses busy suggestions before Escape interrupts generation', () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const interruptions: string[] = []
    terminal.onInterrupt((reason) => interruptions.push(reason))
    const activity = terminal.activity('Thinking…')
    input.write('/he')

    key(input, '', { name: 'escape', sequence: '\u001b' })
    expect(interruptions).toEqual([])
    expect((terminal as never as { draft: string }).draft).toBe('/he')

    key(input, '', { name: 'escape', sequence: '\u001b' })
    expect(interruptions).toEqual(['manual'])
    activity.stop()
    terminal.close()
  })

  it('recalls the newest queued steering prompt with Up', async () => {
    const { input, output, chunks } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    input.write('first\rsecond\r')
    await new Promise((resolve) => setImmediate(resolve))
    key(input, '', { name: 'up', sequence: '\u001b[A' })

    expect(plainTerminalText(chunks.at(-1) ?? '')).toContain(' ❯ second')
    expect(chunks.at(-1)).toContain('1 queued · enter to steer · esc to interrupt')
    activity.stop()
    terminal.close()
  })

  it('reinserts a recalled prompt ahead of controls that arrived after it', async () => {
    const { input, output } = terminalStreams(60, 12)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    input.write('first\rsecond\r')
    await new Promise((resolve) => setImmediate(resolve))
    key(input, '\u0016', { ctrl: true, name: 'v', sequence: '\u0016' })
    key(input, '', { name: 'up', sequence: '\u001b[A' })
    input.write(' edited\r')
    activity.stop()

    await expect(terminal.read('❯ ')).resolves.toMatchObject({ value: 'first', queued: true })
    await expect(terminal.read('❯ ')).resolves.toMatchObject({
      value: 'second edited',
      queued: true,
    })
    await expect(terminal.read('❯ ')).resolves.toEqual({ kind: 'clipboard', value: '' })
    terminal.close()
  })

  it('preserves a mid-stream draft across a structured question', async () => {
    const { input, output } = terminalStreams(60, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    input.write('unfinished follow-up')
    activity.stop()

    const answer = terminal.askQuestion({
      prompt: 'Which service?',
      multi: false,
      options: [{ id: 'api', label: 'API' }],
    })
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(answer).resolves.toEqual({ kind: 'answer', values: ['API'] })

    const followUp = terminal.read('❯ ')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(followUp).resolves.toEqual({ kind: 'line', value: 'unfinished follow-up' })
    terminal.close()
  })

  it('paints only visible transcript rows without terminal scrolling during repeated redraws', () => {
    const { input, output, chunks } = terminalStreams(16, 10)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')

    terminal.write(`${Array.from({ length: 100 }, (_, index) => `line-${index}`).join('\n')}\n`)
    const transcriptFrame = chunks.at(-1) ?? ''
    const transcriptPaints = [...transcriptFrame.matchAll(/\u001b\[(\d+);1H\u001b\[2K/gu)]
    expect(transcriptPaints.length).toBeLessThanOrEqual(output.rows)
    expect(transcriptFrame).not.toContain('line-0')
    expect(transcriptFrame).toContain('line-99')
    expect(transcriptFrame).not.toContain('\n')
    expect(transcriptFrame).not.toContain('\r')
    expect(transcriptFrame).not.toMatch(/\u001b\[\d+;\d+r/u)

    for (let redraw = 0; redraw < 10; redraw += 1) output.emit('resize')
    for (const frame of chunks.slice(-10)) {
      const paintedRows = [...frame.matchAll(/\u001b\[(\d+);1H\u001b\[2K/gu)]
      expect(paintedRows).toHaveLength(0)
      expect(frame).not.toMatch(/\u001b\[\d+;\d+r/u)
      expect(frame).not.toContain('\n')
      expect(frame).not.toContain('\r')
      expect(frame).not.toContain('line-99')
      expect(frame).not.toContain('\u001b[2J')
    }

    terminal.close()
  })

  it('owns transcript scrollback while keeping the composer fixed and sticky', async () => {
    const { input, output, chunks } = terminalStreams(32, 10)
    const terminal = new ReadlineChatTerminal(input, output)
    const submitted = terminal.read('❯ ')

    terminal.write(`${Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n')}\n`)
    expect(chunks.at(-1)).toContain('line-19')

    key(input, '', { name: 'pageup', sequence: '\u001b[5~' })
    const historyFrame = chunks.at(-1) ?? ''
    expect(historyFrame).toContain('line-11')
    expect(historyFrame).not.toContain('line-19')
    expect(historyFrame).toContain('\u001b[8;4H\u001b[?25h')

    terminal.write('line-20\nline-21\n')
    const anchoredFrame = chunks.at(-1) ?? ''
    expect(anchoredFrame).not.toContain('line-20')
    expect(anchoredFrame).not.toContain('line-21')
    expect(anchoredFrame).not.toMatch(/\u001b\[\d+;1H\u001b\[2K/u)

    key(input, '', { ctrl: true, name: 'home', sequence: '\u001b[1;5H' })
    expect(chunks.at(-1)).toContain('line-0')
    key(input, '', { ctrl: true, name: 'end', sequence: '\u001b[1;5F' })
    expect(chunks.at(-1)).toContain('line-21')

    key(input, '', { name: 'pageup', sequence: '\u001b[5~' })
    output.rows = 12
    output.emit('resize')
    const resizedFrame = chunks.at(-1) ?? ''
    expect(resizedFrame).not.toContain('line-21')
    expect(resizedFrame).not.toContain('\n')
    expect(resizedFrame).not.toContain('\r')

    input.write('new question\r')
    await expect(submitted).resolves.toEqual({ kind: 'line', value: 'new question' })
    const submittedFrame = chunks.at(-1) ?? ''
    expect(submittedFrame).toContain('new question')
    expect(submittedFrame).toContain('\u001b[10;1H\u001b[2K')
    expect(plainTerminalText(submittedFrame)).toContain(' ❯ ')
    expect(submittedFrame).not.toContain('\n')
    expect(submittedFrame).not.toContain('\r')
    terminal.close()
  })

  it('wraps ANSI-styled wide graphemes into bounded absolute rows', () => {
    const { input, output, chunks } = terminalStreams(10, 8)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')

    terminal.write('\u001b[31m12345678界Z\u001b[0m')

    const latestFrame = chunks.at(-1) ?? ''
    expect(latestFrame).toContain('\u001b[31m12345678\u001b[0m')
    expect(latestFrame).toContain('\u001b[31m界Z\u001b[0m')
    expect(latestFrame).not.toContain('\n')
    expect(latestFrame).not.toMatch(/\u001b\[\d+;\d+r/u)
    terminal.close()
  })

  it('reflows streamed prose at word boundaries instead of splitting ordinary words', () => {
    const { input, output, chunks } = terminalStreams(21, 8)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')

    terminal.write('happy to build somet')
    expect(chunks.at(-1)).toContain('happy to build somet')

    terminal.write('hing')
    const reflowedFrame = chunks.at(-1) ?? ''
    expect(reflowedFrame).toContain('\u001b[1;1H\u001b[2Khappy to build \u001b[0m')
    expect(reflowedFrame).toContain('\u001b[2;1H\u001b[2Ksomething\u001b[0m')
    expect(reflowedFrame).not.toContain('somet\u001b[0m')
    expect(reflowedFrame).not.toContain('\u001b[2;1H\u001b[2Khing')
    terminal.close()
  })

  it('reopens the user panel on word-wrapped rows without leaking into assistant output', async () => {
    const columns = 21
    const rows = 8
    const { input, output } = terminalStreams(columns, rows)
    const screen = mirrorToHeadless(output, columns, rows)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')

    terminal.userMessage('happy to build something')
    await screen.flush()

    const userLines = visibleTerminalLines(screen.terminal, rows)
    const firstRow = userLines.indexOf(' ❯ happy to build')
    const continuationRow = userLines.indexOf('   something')
    expect(firstRow).toBeGreaterThanOrEqual(0)
    expect(continuationRow).toBe(firstRow + 1)
    expectUserPanelRow(screen.terminal, firstRow, columns)
    expectUserPanelRow(screen.terminal, continuationRow, columns)

    terminal.write('assistant')
    await screen.flush()
    const assistantRow = visibleTerminalLines(screen.terminal, rows).indexOf('● assistant')
    expect(assistantRow).toBeGreaterThanOrEqual(0)
    expect(screen.terminal.buffer.active.getLine(assistantRow)?.getCell(0)?.isBgDefault()).toBe(
      true
    )

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('supports multiline input, grapheme deletion, and history recall', async () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)

    const multiline = terminal.read('❯ ')
    input.write('hello\\\rworld\r')
    await expect(multiline).resolves.toEqual({ kind: 'line', value: 'hello\nworld' })

    const edited = terminal.read('❯ ')
    input.write('A😀B')
    key(input, '', { name: 'left', sequence: '\u001b[D' })
    key(input, '', { name: 'backspace', sequence: '\u007f' })
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(edited).resolves.toEqual({ kind: 'line', value: 'AB' })

    const recalled = terminal.read('❯ ')
    key(input, '', { name: 'up', sequence: '\u001b[A' })
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(recalled).resolves.toEqual({ kind: 'line', value: 'AB' })
    terminal.close()
  })

  it('preserves the live draft cursor when a streamed turn settles', async () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const initial = terminal.read('❯ ')
    input.write('original\r')
    await initial

    const activity = terminal.activity('Thinking…')
    input.write('abcdef')
    key(input, '', { name: 'left', sequence: '\u001b[D' })
    key(input, '', { name: 'left', sequence: '\u001b[D' })
    activity.stop()

    const followUp = terminal.read('❯ ')
    input.write('X\r')
    await expect(followUp).resolves.toEqual({ kind: 'line', value: 'abcdXef' })
    terminal.close()
  })

  it('returns eof after close even when deferred input remains queued', async () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    input.write('stale\r')
    await new Promise((resolve) => setImmediate(resolve))

    terminal.close()

    await expect(terminal.read('❯ ')).resolves.toEqual({ kind: 'eof' })
    activity.stop()
  })

  it('redraws the balanced composer across narrow terminal resizes', async () => {
    const { input, output } = terminalStreams(12, 10)
    const screen = mirrorToHeadless(output, 12, 10)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    await screen.flush()

    expectUserPanelRow(screen.terminal, 6, 12)
    expectUserPanelRow(screen.terminal, 7, 12)
    expectUserPanelRow(screen.terminal, 8, 12)
    expect(screen.terminal.buffer.active.cursorY).toBe(7)

    screen.terminal.resize(40, 16)
    output.columns = 40
    output.rows = 16
    output.emit('resize')
    await screen.flush()

    expectUserPanelRow(screen.terminal, 12, 40)
    expectUserPanelRow(screen.terminal, 13, 40)
    expectUserPanelRow(screen.terminal, 14, 40)
    expect(visibleTerminalLines(screen.terminal, 16)[13]).toBe(' ❯')
    expect(screen.terminal.buffer.active.cursorY).toBe(13)

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('never paints beyond the physical terminal during extreme row resizes', () => {
    const { input, output, chunks } = terminalStreams(20, 14)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    terminal.write('one\ntwo\nthree\nfour')

    for (const rows of [2, 1, 20]) {
      output.rows = rows
      output.emit('resize')
      const frame = chunks.at(-1) ?? ''
      const cursorPositions = [...frame.matchAll(/\u001b\[(\d+);(\d+)H/gu)]
      expect(cursorPositions.length).toBeGreaterThan(0)
      for (const position of cursorPositions) {
        expect(Number(position[1])).toBeLessThanOrEqual(rows)
        expect(Number(position[2])).toBeLessThanOrEqual(output.columns)
      }
      expect(frame).not.toContain('\n')
      expect(frame).not.toContain('\r')
    }

    terminal.close()
  })

  it('respects the physical column count and leaves a no-wrap safety column', () => {
    const { input, output, chunks } = terminalStreams(14, 8)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    terminal.write('alpha beta 界界 gamma')

    for (const columns of [2, 1, 20]) {
      output.columns = columns
      output.emit('resize')
      const frame = chunks.at(-1) ?? ''
      const cursorPositions = [...frame.matchAll(/\u001b\[(\d+);(\d+)H/gu)]
      expect(cursorPositions.length).toBeGreaterThan(0)
      for (const position of cursorPositions) {
        expect(Number(position[1])).toBeLessThanOrEqual(output.rows)
        expect(Number(position[2])).toBeLessThanOrEqual(columns)
      }
      for (const payload of paintedPayloads(frame)) {
        expect(payloadDisplayWidth(payload)).toBeLessThanOrEqual(Math.max(0, columns - 1))
      }
      expect(frame).not.toContain('\n')
      expect(frame).not.toContain('\r')
    }

    terminal.close()
  })

  it('keeps the meaningful composer and question row focused at one terminal row', async () => {
    const { input, output, chunks } = terminalStreams(40, 1)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')

    const busyFrame = chunks.at(-1) ?? ''
    expect(busyFrame).toContain('❯ ')
    expect(busyFrame).not.toContain('esc to interrupt')
    expect(paintedPayloads(busyFrame)).toHaveLength(1)
    activity.stop()

    const answer = terminal.askQuestion({
      prompt: 'Which service?',
      multi: false,
      options: [
        { id: 'api', label: 'API' },
        { id: 'worker', label: 'Worker' },
      ],
    })
    const questionFrame = chunks.at(-1) ?? ''
    expect(questionFrame).toContain('❯ 1. API')
    expect(questionFrame).not.toContain('navigate')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(answer).resolves.toEqual({ kind: 'answer', values: ['API'] })
    terminal.close()
  })

  it('clips the balanced composer around its input on tiny terminal heights', async () => {
    const columns = 40
    const { input, output } = terminalStreams(columns, 6)
    const screen = mirrorToHeadless(output, columns, 6)
    const terminal = new ReadlineChatTerminal(input, output)
    void terminal.read('❯ ')
    const expectedCursorRows = new Map([
      [5, 2],
      [4, 1],
      [3, 1],
      [2, 0],
      [1, 0],
    ])

    for (const rows of [5, 4, 3, 2, 1]) {
      screen.terminal.resize(columns, rows)
      output.rows = rows
      output.emit('resize')
      await screen.flush()

      const cursorRow = expectedCursorRows.get(rows)
      if (cursorRow === undefined) throw new Error(`Missing cursor expectation for ${rows} rows`)
      expect(screen.terminal.buffer.active.cursorY).toBe(cursorRow)
      expect(screen.terminal.buffer.active.cursorX).toBe(3)
      expect(visibleTerminalLines(screen.terminal, rows)[cursorRow]).toBe(' ❯')
      expectUserPanelRow(screen.terminal, cursorRow, columns)
      if (cursorRow > 0) expectUserPanelRow(screen.terminal, cursorRow - 1, columns)
      if (cursorRow + 1 < rows) expectUserPanelRow(screen.terminal, cursorRow + 1, columns)
      if (rows >= 4) {
        expect(
          screen.terminal.buffer.active
            .getLine(rows - 1)
            ?.getCell(0)
            ?.isBgDefault()
        ).toBe(true)
      }
    }

    terminal.close()
    await screen.flush()
    screen.terminal.dispose()
  })

  it('returns Ctrl+V with the current draft and implements clear-aware Ctrl+C', async () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)

    const clipboard = terminal.read('❯ ')
    input.write('explain this')
    key(input, '\u0016', { ctrl: true, name: 'v', sequence: '\u0016' })
    await expect(clipboard).resolves.toEqual({ kind: 'clipboard', value: 'explain this' })

    const withDraft = terminal.read('❯ ')
    input.write('discard me')
    key(input, '\u0003', { ctrl: true, name: 'c', sequence: '\u0003' })
    await expect(withDraft).resolves.toEqual({ kind: 'interrupt', empty: false })

    const empty = terminal.read('❯ ')
    key(input, '\u0003', { ctrl: true, name: 'c', sequence: '\u0003' })
    await expect(empty).resolves.toEqual({ kind: 'interrupt', empty: true })
    terminal.close()
  })

  it('renders questions in the bottom panel with focus, custom answers, and cancellation', async () => {
    const { input, output, chunks } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const question = {
      prompt: 'Which service?',
      multi: false,
      options: [
        { id: 'api', label: 'API' },
        { id: 'worker', label: 'Worker' },
      ],
    }

    const selected = terminal.askQuestion(question)
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    expect(chunks.at(-1)).toContain('❯ 2. Worker')
    key(input, '\r', { name: 'return', sequence: '\r' })
    await expect(selected).resolves.toEqual({ kind: 'answer', values: ['Worker'] })

    const custom = terminal.askQuestion(question)
    input.write('my service\r')
    await expect(custom).resolves.toEqual({ kind: 'answer', values: ['my service'] })

    const cancelled = terminal.askQuestion(question)
    key(input, '', { name: 'escape', sequence: '\u001b' })
    await expect(cancelled).resolves.toEqual({ kind: 'cancel' })
    expect(chunks.join('')).not.toContain('Choose an option:')
    expect(chunks.join('')).not.toContain('Selected:')
    terminal.close()
  })

  it('keeps multi-select state in place and submits it explicitly', async () => {
    const { input, output, chunks } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const result = terminal.askQuestion({
      prompt: 'Which services?',
      multi: true,
      options: [
        { id: 'api', label: 'API' },
        { id: 'worker', label: 'Worker' },
      ],
    })

    key(input, ' ', { name: 'space', sequence: ' ' })
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    key(input, ' ', { name: 'space', sequence: ' ' })
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    key(input, '', { name: 'down', sequence: '\u001b[B' })
    expect(chunks.at(-1)).toContain('❯ \u001b[2mSubmit answers')
    key(input, '\r', { name: 'return', sequence: '\r' })

    await expect(result).resolves.toEqual({ kind: 'answer', values: ['API', 'Worker'] })
    expect(chunks.join('')).toContain('[✓] API')
    expect(chunks.join('')).toContain('[✓] Worker')
    expect(chunks.join('')).not.toContain('Selected:')
    terminal.close()
  })

  it('keeps completed tool rows in the transcript after transient activity clears', () => {
    const { input, output, chunks } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    activity.thinking('Inspecting\nworkflows…')
    activity.event({
      kind: 'tool',
      id: 'tool-1',
      label: 'Read\nworkspace',
      state: 'running',
    })
    activity.event({ kind: 'tool', id: 'tool-1', label: 'Read workspace', state: 'complete' })
    activity.event({
      kind: 'subagent',
      id: 'agent-1',
      label: 'Research\u001b]0;owned\u0007 agent',
      state: 'running',
    })
    activity.event({
      kind: 'narration',
      parentId: 'agent-1',
      delta: 'Found the relevant workflow',
    })
    activity.event({
      kind: 'subagent',
      id: 'agent-1',
      label: 'Research\u001b]0;owned\u0007 agent',
      state: 'error',
    })
    activity.clear()
    activity.stop()

    const rendered = chunks.join('')
    expect(rendered).toContain('\u001b[32m●\u001b[0m Read workspace')
    expect(rendered).toContain('\u001b[31m●\u001b[0m Research agent')
    expect(rendered).toContain('  \u001b[2mFound the relevant workflow\u001b[0m')
    expect(rendered).not.toContain('Research agent \u001b[2mfailed')
    expect(rendered).not.toContain('  \u001b[32m●\u001b[0m Read workspace')
    expect(rendered).not.toContain('  \u001b[31m●\u001b[0m Research agent')
    expect(rendered).not.toContain('owned')
    expect(rendered).not.toContain('✗')
    terminal.close()
  })

  it('renders nested lanes in wire order with verbatim adjacent narration and structural seams', () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    activity.event({
      kind: 'subagent',
      id: 'agent-root',
      label: 'Workflow Agent',
      state: 'running',
    })
    activity.event({ kind: 'narration', parentId: 'agent-root', delta: 'First ' })
    activity.event({ kind: 'narration', parentId: 'agent-root', delta: 'step\n\ncontinues' })
    activity.event({
      kind: 'tool',
      id: 'tool-read',
      parentId: 'agent-root',
      label: 'Read file',
      state: 'complete',
    })
    activity.event({ kind: 'narration', parentId: 'agent-root', delta: 'After tool' })
    activity.event({
      kind: 'subagent',
      id: 'agent-child',
      parentId: 'agent-root',
      label: 'Deploy Agent',
      state: 'running',
    })
    activity.event({ kind: 'narration', parentId: 'agent-child', delta: 'Shipping now' })

    const probe = terminal as never as { activityEventsDisplay(): string }
    expect(plainTerminalText(probe.activityEventsDisplay()).split('\n')).toEqual([
      '● Workflow Agent',
      '  First step',
      '  ',
      '  continues',
      '  ● Read file',
      '  After tool',
      '  ● Deploy Agent',
      '    Shipping now',
    ])

    activity.stop()
    terminal.close()
  })

  it('keeps parallel same-name subagents separate by id', () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    for (const [id, narration] of [
      ['agent-a', 'First lane'],
      ['agent-b', 'Second lane'],
    ] as const) {
      activity.event({ kind: 'subagent', id, label: 'Research Agent', state: 'running' })
      activity.event({ kind: 'narration', parentId: id, delta: narration })
      activity.event({ kind: 'subagent', id, label: 'Research Agent', state: 'complete' })
    }

    const probe = terminal as never as { activityEventsDisplay(): string }
    expect(plainTerminalText(probe.activityEventsDisplay()).split('\n')).toEqual([
      '● Research Agent',
      '  First lane',
      '● Research Agent',
      '  Second lane',
    ])

    activity.stop()
    terminal.close()
  })

  it('commits only whole settled roots and prunes closed empty subagent groups', () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    activity.event({
      kind: 'subagent',
      id: 'agent-root',
      label: 'Build Agent',
      state: 'complete',
    })
    activity.event({
      kind: 'tool',
      id: 'tool-child',
      parentId: 'agent-root',
      label: 'Editing workflow',
      state: 'running',
    })
    activity.event({
      kind: 'subagent',
      id: 'agent-empty',
      label: 'Empty Agent',
      state: 'complete',
    })

    const probe = terminal as never as {
      activityEventsDisplay(): string
      transcript: string
    }
    activity.clear()
    expect(plainTerminalText(probe.transcript)).toBe('')
    expect(plainTerminalText(probe.activityEventsDisplay())).toContain('Build Agent')
    expect(plainTerminalText(probe.activityEventsDisplay())).not.toContain('Empty Agent')

    activity.event({
      kind: 'tool',
      id: 'tool-child',
      parentId: 'agent-root',
      label: 'Edited workflow',
      state: 'complete',
    })
    activity.clear()
    expect(plainTerminalText(probe.transcript).trim().split('\n')).toEqual([
      '● Build Agent',
      '  ● Edited workflow',
    ])
    expect(probe.activityEventsDisplay()).toBe('')

    activity.stop()
    terminal.close()
  })

  it('pins the UI thinking label while tool activity remains in the transcript tail', () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    activity.thinking('Planning next step')
    activity.event({ kind: 'tool', id: 'tool-1', label: 'Reading file', state: 'running' })

    const probe = terminal as never as {
      activityEventsDisplay(): string
      activityStatusLine(): string
      buildPanel(rows: number): { lines: string[] }
    }
    const events = probe
      .activityEventsDisplay()
      .split('\n')
      .map((line) => line.replace(/\u001b\[[0-9;:]*m/gu, ''))
    const status = probe.activityStatusLine().replace(/\u001b\[[0-9;:]*m/gu, '')
    const panel = probe.buildPanel(24).lines.map((line) => line.replace(/\u001b\[[0-9;:]*m/gu, ''))
    const statusRow = panel.findIndex((line) => line.includes('Thinking…'))
    const composerRow = panel.findIndex((line) => line.startsWith(' ❯'))

    expect(events).toEqual(['● Reading file…'])
    expect(status).toMatch(/^[·•●] Thinking…$/u)
    expect(status).not.toContain('Planning next step')
    expect(statusRow).toBeGreaterThanOrEqual(0)
    expect(statusRow).toBe(composerRow - 3)
    expect(panel[composerRow - 2]).toBe('')
    expect(panel[composerRow - 1]).toBe(' ')
    expect(panel[composerRow + 1]).toBe(' ')

    activity.clear()
    expect(probe.activityStatusLine().replace(/\u001b\[[0-9;:]*m/gu, '')).toMatch(
      /^[·•●] Thinking…$/u
    )
    activity.stop()
    terminal.close()
  })

  it('commits one settled work duration without showing a live time counter', () => {
    const { input, output } = terminalStreams()
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    const probe = terminal as never as {
      activityStatusLine(): string
      transcript: string
    }

    expect(probe.activityStatusLine()).not.toContain('Worked for')
    expect(probe.activityStatusLine()).not.toContain('1m')
    terminal.write('Done')
    now.mockReturnValue(75_000)
    activity.complete()
    activity.complete()

    const transcript = probe.transcript.replace(/\u001b\[[0-9;:]*m/gu, '')
    expect(transcript.match(/✻ Worked for 1m 5s/gu)).toHaveLength(1)
    expect(probe.activityStatusLine()).toBe('')

    terminal.close()
    now.mockRestore()
  })

  it('preserves every completed row when a turn exceeds the live activity window', () => {
    const { input, output } = terminalStreams()
    const terminal = new ReadlineChatTerminal(input, output)
    const activity = terminal.activity('Thinking…')
    const labels = Array.from({ length: 30 }, (_, index) => `Tool ${index}`)

    for (const [index, label] of labels.entries()) {
      activity.event({ kind: 'tool', id: `tool-${index}`, label, state: 'complete' })
    }
    activity.stop()

    const transcript = (
      terminal as never as {
        transcript: string
      }
    ).transcript
      .replace(/\u001b\[[0-9;:]*m/gu, '')
      .trim()
      .split('\n')
    expect(transcript).toEqual(labels.map((label) => `● ${label}`))

    terminal.close()
  })

  it('ignores stale activity handles and settles an empty successful turn once', () => {
    const { input, output } = terminalStreams()
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const terminal = new ReadlineChatTerminal(input, output)
    const stale = terminal.activity('Thinking…')
    const current = terminal.activity('Thinking…')
    const probe = terminal as never as {
      activityEventsDisplay(): string
      activityStatusLine(): string
      transcript: string
    }

    stale.update('Stale')
    stale.event({ kind: 'tool', id: 'stale-tool', label: 'Stale tool', state: 'complete' })
    stale.complete()
    expect(probe.activityStatusLine()).toContain('Thinking…')
    expect(probe.activityEventsDisplay()).not.toContain('Stale tool')

    now.mockReturnValue(12_000)
    current.complete()
    current.complete()
    expect(
      probe.transcript.replace(/\u001b\[[0-9;:]*m/gu, '').match(/Worked for 2s/gu)
    ).toHaveLength(1)

    terminal.close()
    now.mockRestore()
  })

  it('queues rapid non-TTY lines and leaves non-interactive output free of screen controls', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (chunk) => chunks.push(String(chunk)))
    const terminal = new ReadlineChatTerminal(input, output)

    input.write('first\nsecond\n')
    await new Promise((resolve) => setImmediate(resolve))

    await expect(terminal.read('> ')).resolves.toEqual({
      kind: 'line',
      value: 'first',
      queued: true,
      display: 'first',
    })
    await expect(terminal.read('> ')).resolves.toEqual({
      kind: 'line',
      value: 'second',
      queued: true,
      display: 'second',
    })
    terminal.write('plain output')
    expect(chunks.join('')).toBe('plain output')
    expect(chunks.join('')).not.toContain('\u001b[')
    terminal.close()
  })
})
