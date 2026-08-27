import { setTimeout as sleep } from 'node:timers/promises'
import chalk from 'chalk'
import { type Command, Option } from 'commander'
import { clientFrom } from '../../context'
import type {
  CompleteTableImportResponse,
  CreateTableImportResponse,
  GetTableImportResponse,
} from '../../generated/v2-api'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError, type SimClient } from '../../http/client'
import { coerce, encodeFolderPath, type FieldSpec } from '../../runtime/request'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

type TableImport = GetTableImportResponse['data']

interface ImportOptions {
  name?: string
  tableId?: string
  mode?: string
  folder?: string
  fileId?: string
  mapping?: string
  createColumns?: string
  timezone?: string
  wait: boolean
  yes?: boolean
}

const IMPORT_POLL_MS = 1500
const IMPORT_SETTLED = new Set(['completed', 'failed', 'canceled', 'expired'])

function tableNameFrom(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!cleaned) return 'imported_table'
  return (/^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned).slice(0, 128)
}

function jsonFlag(raw: string, flagName: string, kind: FieldSpec['kind']): unknown {
  return coerce(raw, { kind }, { json: true }, flagName)
}

/**
 * The rejection counters a caller has to see, or `{}` when nothing was dropped.
 *
 * An import answers `200` and reports a `completed` status even when it dropped
 * rows it could not parse, so a run that silently lost half a file looked
 * exactly like a clean one. Only reported when non-zero: a clean import keeps
 * the output it always had, and a field that is always `0` teaches people to
 * stop reading it.
 *
 * The samples are flattened to text here rather than passed through as records:
 * the result printer renders every field with `String(value)`, which turns an
 * array of objects into `[object Object]`.
 */
function rejectionFields(job: TableImport): Record<string, unknown> {
  const rows = job.rowsRejected ?? 0
  const cells = job.cellsRejected ?? 0
  if (rows === 0 && cells === 0) return {}
  // `line` is nullable: a rejection that applies to the whole file rather than
  // to one row has none, and `line null:` reads as a parser bug.
  const samples = (job.rejectedSamples ?? []).map((sample) =>
    sample.line === null || sample.line === undefined
      ? `${sample.message} (${sample.code})`
      : `line ${sample.line}: ${sample.message} (${sample.code})`
  )
  return {
    rowsRejected: rows,
    cellsRejected: cells,
    ...(samples.length > 0 ? { rejectedSamples: samples } : {}),
  }
}

/**
 * The progress text for an in-flight import, naming rejections once there are any.
 *
 * Cells are counted alongside rows because an import that coerced away values
 * without dropping a single row reports `rowsRejected: 0`, and a suffix keyed on
 * rows alone rendered that run as clean while it was losing data.
 */
function progressLine(job: TableImport): string {
  const rows = job.rowsRejected ?? 0
  const cells = job.cellsRejected ?? 0
  const parts: string[] = []
  if (rows > 0) parts.push(`${rows} rows rejected`)
  if (cells > 0) parts.push(`${cells} cells rejected`)
  const suffix = parts.length > 0 ? `, ${parts.join(', ')}` : ''
  return `${job.status}… ${job.rowsProcessed} rows${suffix}`
}

async function watchImport(
  client: SimClient,
  workspaceId: string,
  job: TableImport
): Promise<TableImport> {
  let current = job
  let reported: string | null = null

  while (!IMPORT_SETTLED.has(current.status)) {
    await sleep(IMPORT_POLL_MS)
    const next = await client.request<{ data: TableImport }>(
      `/api/v2/tables/imports/${encodeURIComponent(current.id)}`,
      { query: { workspaceId } }
    )
    current = next.data
    const line = progressLine(current)
    if (process.stderr.isTTY && line !== reported) {
      reported = line
      process.stderr.write(`\r${chalk.dim(line)}\u001b[K`)
    }
  }

  if (process.stderr.isTTY && reported !== null) process.stderr.write('\r\u001b[K')
  return current
}

function validateTargetOptions(options: ImportOptions): boolean {
  const intoExisting = Boolean(options.tableId)
  const misplaced = intoExisting
    ? ([
        ['--name', options.name],
        ['--folder', options.folder],
      ] as const)
    : ([
        ['--mode', options.mode],
        ['--mapping', options.mapping],
        ['--create-columns', options.createColumns],
      ] as const)

  for (const [flag, value] of misplaced) {
    if (value === undefined) continue
    throw new SimApiError(
      intoExisting
        ? `${flag} applies to a new table; --table-id already names the destination`
        : `${flag} applies to --table-id: a new table takes its name and columns from the CSV`,
      0
    )
  }
  return intoExisting
}

export function attachTableImport(tables: Command): void {
  tables
    .command('import')
    .argument('[path]', 'Local CSV file to import; omit when using --file-id')
    .allowExcessArguments(false)
    .description('Import a CSV, into a new table by default')
    .option(
      '--name <name>',
      'Identifier for the new table: letters, numbers, and underscores; defaults to the sanitized file name'
    )
    .option('--table-id <id>', 'Import into this existing table instead of creating one')
    .addOption(
      new Option(
        '--mode <append|replace>',
        'How to write into --table-id (default: append)'
      ).choices(['append', 'replace'])
    )
    .option('--folder <path>', 'Folder path for the new table, as shown in the app')
    .option('--file-id <id>', 'Import a file already in the workspace instead of a local path')
    .option('--mapping <json|@file>', 'Column mapping (--table-id only)')
    .option('--create-columns <json|@file>', 'Columns to create (--table-id only)')
    .option('--timezone <iana>', 'Timezone for date parsing, e.g. America/New_York')
    // Not the bare `(required)` marker the generated flags use: the docs
    // generator keys its Required column off that exact suffix, and this one is
    // required for a single shape of the command.
    .option('-y, --yes', 'Confirm this destructive operation (required with --mode replace)')
    .option('--no-wait', 'Return once the import is queued instead of watching it')
    .action(async (path: string | undefined, options: ImportOptions, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      if (Boolean(path) === Boolean(options.fileId)) {
        throw new SimApiError('Pass exactly one of <path> or --file-id <id>', 0)
      }

      const intoExisting = validateTargetOptions(options)

      // Gated the way the eleven destructive `tables` leaves are, but only for
      // the shape that destroys something: `--mode replace` empties the table
      // before its first batch, while an append or a new table writes nothing
      // away. Refused before the file is opened, as the target-option guards
      // above are, so the refusal costs nothing. Widening it to every import
      // would put a prompt on the common path and teach the reflexive `--yes`
      // the gate depends on nobody learning.
      if (intoExisting && options.mode === 'replace' && options.yes !== true) {
        throw new SimApiError(
          'This deletes every row in the table before loading the CSV and cannot be undone. Re-run with --yes to confirm.',
          0
        )
      }

      const local = path ? await localFile(path) : null
      const source = local
        ? {
            type: 'upload',
            name: local.name,
            contentType: contentTypeFor(local.name),
            size: local.size,
          }
        : { type: 'workspace_file', fileId: options.fileId }

      let target: Record<string, unknown>
      if (intoExisting) {
        target = { type: 'existing', tableId: options.tableId, mode: options.mode ?? 'append' }
      } else {
        const name = options.name ?? (local ? tableNameFrom(local.name) : undefined)
        if (!name) {
          throw new SimApiError('Pass --name <name> to say what the new table is called', 0)
        }
        target = {
          type: 'new',
          name,
          ...(options.folder !== undefined ? { folderPath: encodeFolderPath(options.folder) } : {}),
        }
      }

      const started = await client.request<CreateTableImportResponse>(
        V2_OPERATIONS.createTableImport.path,
        {
          method: 'POST',
          body: {
            workspaceId,
            source,
            target,
            ...(options.mapping ? { mapping: jsonFlag(options.mapping, 'mapping', 'object') } : {}),
            ...(options.createColumns
              ? { createColumns: jsonFlag(options.createColumns, 'create-columns', 'array') }
              : {}),
            ...(options.timezone ? { timezone: options.timezone } : {}),
          },
        }
      )

      let job: TableImport = started.data.session
      if (path) {
        if (!local || !started.data.uploadToken || !started.data.transfer) {
          throw new Error('Local table import did not return an upload transfer')
        }
        job = await finishUploadSession<CompleteTableImportResponse['data']>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/tables/imports/${encodeURIComponent(job.id)}`,
            uploadToken: started.data.uploadToken,
            transfer: started.data.transfer,
            size: local.size,
          },
          path
        )
      }

      if (!options.wait) {
        printProtocolResult(profile.output, {
          id: job.id,
          status: job.status,
          tableId: job.tableId,
          rowsProcessed: job.rowsProcessed,
          ...rejectionFields(job),
        })
        return
      }

      const finished = await watchImport(client, workspaceId, job)
      if (finished.status !== 'completed') {
        throw new SimApiError(
          `Import ${finished.status}${finished.error ? `: ${finished.error}` : ''}`,
          0
        )
      }
      printProtocolResult(profile.output, {
        id: finished.id,
        status: finished.status,
        tableId: finished.tableId,
        rowsProcessed: finished.rowsProcessed,
        ...rejectionFields(finished),
      })
    })
}
