import { setTimeout as sleep } from 'node:timers/promises'
import chalk from 'chalk'
import { type Command, Option } from 'commander'
import { clientFrom } from '../../context.js'
import { SimApiError, type SimClient } from '../../http/client.js'
import { coerce } from '../../runtime/request.js'
import { contentTypeFor, localFile } from '../../transfer/local-file.js'
import { finishTransfer } from '../../transfer/multipart.js'
import { printProtocolResult } from './result.js'

interface TableImport {
  id: string
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  tableId: string | null
  rowsProcessed: number
  error: string | null
  upload: { uploadToken: string; partSize: number; partCount: number } | null
}

interface ImportOptions {
  name?: string
  tableId?: string
  mode?: string
  folderId?: string
  fileId?: string
  mapping?: string
  createColumns?: string
  timezone?: string
  wait: boolean
}

const IMPORT_POLL_MS = 1500
const IMPORT_SETTLED = new Set(['completed', 'failed', 'canceled', 'expired'])

function tableNameFrom(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!cleaned) return 'imported_table'
  return (/^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned).slice(0, 128)
}

function jsonFlag(raw: string, flagName: string): unknown {
  return coerce(raw, { kind: 'object' }, { json: true }, flagName)
}

async function watchImport(
  client: SimClient,
  workspaceId: string,
  job: TableImport
): Promise<TableImport> {
  let current = job
  let reported = -1

  while (!IMPORT_SETTLED.has(current.status)) {
    await sleep(IMPORT_POLL_MS)
    const next = await client.request<{ data: TableImport }>(
      `/api/v2/tables/imports/${encodeURIComponent(current.id)}`,
      { query: { workspaceId } }
    )
    current = next.data
    if (process.stderr.isTTY && current.rowsProcessed !== reported) {
      reported = current.rowsProcessed
      process.stderr.write(`\r${chalk.dim(`${current.status}… ${reported} rows`)}\u001b[K`)
    }
  }

  if (process.stderr.isTTY && reported >= 0) process.stderr.write('\r\u001b[K')
  return current
}

function validateTargetOptions(options: ImportOptions): boolean {
  const intoExisting = Boolean(options.tableId)
  const misplaced = intoExisting
    ? ([
        ['--name', options.name],
        ['--folder-id', options.folderId],
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
    .command('import [path]')
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
    .option('--folder-id <id>', 'Folder for the new table')
    .option('--file-id <id>', 'Import a file already in the workspace instead of a local path')
    .option('--mapping <json|@file>', 'Column mapping (--table-id only)')
    .option('--create-columns <json|@file>', 'Columns to create (--table-id only)')
    .option('--timezone <iana>', 'Timezone for date parsing, e.g. America/New_York')
    .option('--no-wait', 'Return once the import is queued instead of watching it')
    .action(async (path: string | undefined, options: ImportOptions, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      if (Boolean(path) === Boolean(options.fileId)) {
        throw new SimApiError('Pass exactly one of <path> or --file-id <id>', 0)
      }

      const intoExisting = validateTargetOptions(options)
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
        target = { type: 'new', name, ...(options.folderId ? { folderId: options.folderId } : {}) }
      }

      const started = await client.request<{ data: TableImport }>('/api/v2/tables/imports', {
        method: 'POST',
        body: {
          workspaceId,
          source,
          target,
          ...(options.mapping ? { mapping: jsonFlag(options.mapping, 'mapping') } : {}),
          ...(options.createColumns
            ? { createColumns: jsonFlag(options.createColumns, 'create-columns') }
            : {}),
          ...(options.timezone ? { timezone: options.timezone } : {}),
        },
      })

      let job = started.data
      if (path && job.upload) {
        job = await finishTransfer<TableImport>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/tables/imports/${encodeURIComponent(job.id)}`,
            uploadToken: job.upload.uploadToken,
            partSize: job.upload.partSize,
            partCount: job.upload.partCount,
            size: local?.size ?? 0,
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
      })
    })
}
