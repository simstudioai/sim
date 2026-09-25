import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

const { mockRequest, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'json' },
}))

/** The poll loop's own wait; a real 1.5s pause per poll is not worth testing through. */
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

beforeEach(() => {
  vi.restoreAllMocks()
  mockRequest.mockReset()
  output.format = 'json'
})

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

async function runImport(argv: string[]) {
  await program().parseAsync(['node', 'sim', 'table', 'import', ...argv])
}

describe('tables import argument guards', () => {
  it('refuses to replace an existing table without --yes', async () => {
    await expect(runImport(['f.csv', '--table-id', 't', '--mode', 'replace'])).rejects.toThrow(
      /Re-run with --yes to confirm/
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('leaves the shapes that write nothing away ungated', async () => {
    mockRequest.mockResolvedValue({
      data: {
        session: { id: 'i1', status: 'completed', tableId: 't', rowsProcessed: 0, error: null },
        uploadToken: null,
        transfer: null,
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runImport(['--file-id', 'w_1', '--table-id', 't', '--mode', 'append'])
    expect(mockRequest).toHaveBeenCalled()

    mockRequest.mockClear()
    await runImport(['--file-id', 'w_1', '--name', 'Customers'])
    expect(mockRequest).toHaveBeenCalled()
  })
})

describe('tables import output', () => {
  it('prints a normalized result without transfer secrets', async () => {
    mockRequest.mockResolvedValue({
      data: {
        session: {
          id: 'import_1',
          status: 'queued',
          tableId: 'table_1',
          rowsProcessed: 0,
          error: null,
        },
        uploadToken: null,
        transfer: null,
      },
    })
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))

    await runImport([
      '--file-id',
      'file_1',
      '--name',
      'Customers',
      '--folder',
      'Reports',
      '--no-wait',
    ])

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/tables/imports', {
      method: 'POST',
      body: {
        workspaceId: 'ws_local',
        source: { type: 'workspace_file', fileId: 'file_1' },
        target: { type: 'new', name: 'Customers', folderPath: 'Reports' },
      },
    })

    expect(JSON.parse(logged[0])).toEqual({
      id: 'import_1',
      status: 'queued',
      tableId: 'table_1',
      rowsProcessed: 0,
    })
    expect(logged[0]).not.toContain('uploadToken')
  })
})

describe('tables import rejection reporting', () => {
  /** A settled session never enters the poll loop, so the import returns at once. */
  function completedImport(extra: Record<string, unknown>) {
    return {
      data: {
        session: {
          id: 'import_1',
          status: 'completed',
          tableId: 'table_1',
          rowsProcessed: 1,
          rowsRejected: 0,
          cellsRejected: 0,
          rejectedSamples: [],
          error: null,
          ...extra,
        },
        uploadToken: null,
        transfer: null,
      },
    }
  }

  async function importAndCapture(extra: Record<string, unknown>): Promise<string> {
    mockRequest.mockResolvedValue(completedImport(extra))
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => logged.push(line))
    await runImport(['--file-id', 'file_1', '--name', 'Customers'])
    return logged[0]
  }

  /**
   * Runs an import that polls once before settling, and returns what the poll
   * loop wrote to the progress line. A non-TTY stderr suppresses it entirely, so
   * the flag is asserted on rather than inherited from the test runner.
   */
  async function _pollAndCaptureProgress(running: Record<string, unknown>): Promise<string[]> {
    mockRequest
      .mockResolvedValueOnce({
        data: {
          session: { id: 'import_1', status: 'queued', tableId: 'table_1', rowsProcessed: 0 },
          uploadToken: null,
          transfer: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: 'import_1',
          status: 'running',
          tableId: 'table_1',
          rowsProcessed: 7,
          rejectedSamples: [],
          error: null,
          ...running,
        },
      })
      .mockResolvedValue({
        data: {
          id: 'import_1',
          status: 'completed',
          tableId: 'table_1',
          rowsProcessed: 7,
          rowsRejected: 0,
          cellsRejected: 0,
          rejectedSamples: [],
          error: null,
        },
      })

    const written: string[] = []
    const wasTTY = process.stderr.isTTY
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runImport(['--file-id', 'file_1', '--name', 'Customers'])
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', { value: wasTTY, configurable: true })
    }
    return written
  }

  it('reports the rejected rows a completed import dropped', async () => {
    const line = await importAndCapture({
      rowsRejected: 1,
      cellsRejected: 0,
      rejectedSamples: [{ code: 'CSV_PARSE_ERROR', line: 2, message: 'unterminated quote' }],
    })

    expect(JSON.parse(line)).toMatchObject({
      rowsProcessed: 1,
      rowsRejected: 1,
      cellsRejected: 0,
      rejectedSamples: ['line 2: unterminated quote (CSV_PARSE_ERROR)'],
    })
  })

  it('reports rejected cells even when every row landed', async () => {
    const line = await importAndCapture({ rowsRejected: 0, cellsRejected: 3, rejectedSamples: [] })

    expect(JSON.parse(line)).toMatchObject({ rowsRejected: 0, cellsRejected: 3 })
  })
})
