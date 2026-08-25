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
  it('refuses to guess the source', async () => {
    await expect(runImport([])).rejects.toThrow(/exactly one of <path>/)
    await expect(runImport(['f.csv', '--file-id', 'w_1'])).rejects.toThrow(/exactly one of <path>/)
  })

  it('rejects existing-table flags when creating one', async () => {
    await expect(runImport(['f.csv', '--mode', 'replace'])).rejects.toThrow(/applies to --table-id/)
    await expect(runImport(['f.csv', '--mapping', '{}'])).rejects.toThrow(/applies to --table-id/)
    await expect(runImport(['f.csv', '--create-columns', '{}'])).rejects.toThrow(
      /applies to --table-id/
    )
  })

  it('rejects new-table flags when importing into an existing one', async () => {
    await expect(runImport(['f.csv', '--table-id', 't', '--name', 'x'])).rejects.toThrow(
      /--table-id already names the destination/
    )
    await expect(runImport(['f.csv', '--table-id', 't', '--folder', '/Reports'])).rejects.toThrow(
      /--table-id already names the destination/
    )
  })

  it('asks for a name when there is no file name to take one from', async () => {
    await expect(runImport(['--file-id', 'w_1'])).rejects.toThrow(/--name <name>/)
  })

  it('checks target options before touching the filesystem', async () => {
    await expect(runImport(['f.csv', '--mode', 'append'])).rejects.toThrow(/applies to --table-id/)
  })

  it('rejects an invalid import mode before making a request', async () => {
    await expect(
      runImport(['--file-id', 'w_1', '--name', 'Customers', '--mode', 'merge'])
    ).rejects.toThrow(/allowed choices are append, replace/i)
    expect(mockRequest).not.toHaveBeenCalled()
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

  it('encodes the destination folder the same way every other --folder is', async () => {
    mockRequest.mockResolvedValue({
      data: { session: { id: 'import_1', status: 'queued' }, uploadToken: null, transfer: null },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runImport([
      '--file-id',
      'f_1',
      '--name',
      'Customers',
      '--folder',
      '/Q1 (draft)',
      '--no-wait',
    ])

    expect(mockRequest.mock.calls[0][1].body.target).toMatchObject({
      folderPath: '/Q1%20%28draft%29',
    })
  })

  it('rejects an extra positional instead of silently dropping the file it names', async () => {
    await expect(runImport(['alpha.csv', 'beta.csv'])).rejects.toThrow(/too many arguments/)
    expect(mockRequest).not.toHaveBeenCalled()
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
  async function pollAndCaptureProgress(running: Record<string, unknown>): Promise<string[]> {
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

  /** A whole-file rejection carries no line number, and `line null` is not one. */
  it('names a rejection with no line without inventing one', async () => {
    const line = await importAndCapture({
      rowsRejected: 1,
      cellsRejected: 0,
      rejectedSamples: [{ code: 'CSV_HEADER_INVALID', line: null, message: 'no header row' }],
    })

    expect(JSON.parse(line)).toMatchObject({
      rejectedSamples: ['no header row (CSV_HEADER_INVALID)'],
    })
  })

  it('reports rejected cells even when every row landed', async () => {
    const line = await importAndCapture({ rowsRejected: 0, cellsRejected: 3, rejectedSamples: [] })

    expect(JSON.parse(line)).toMatchObject({ rowsRejected: 0, cellsRejected: 3 })
  })

  /**
   * An import that coerced values without dropping a row reports
   * `rowsRejected: 0`, so progress keyed on rows alone rendered a lossy run as
   * clean for as long as it took to finish.
   */
  it('names rejected cells in progress even when no row was rejected', async () => {
    const lines = await pollAndCaptureProgress({ rowsRejected: 0, cellsRejected: 4 })

    expect(lines.join('')).toContain('4 cells rejected')
  })

  it('says nothing about rejections while an import is still clean', async () => {
    const lines = await pollAndCaptureProgress({ rowsRejected: 0, cellsRejected: 0 })

    expect(lines.join('')).not.toContain('rejected')
  })

  /** A clean import keeps exactly the output it always had. */
  it('adds nothing when nothing was rejected', async () => {
    const line = await importAndCapture({})

    expect(JSON.parse(line)).toEqual({
      id: 'import_1',
      status: 'completed',
      tableId: 'table_1',
      rowsProcessed: 1,
    })
  })
})
