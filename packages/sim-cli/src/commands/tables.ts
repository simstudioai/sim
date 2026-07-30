import chalk from 'chalk'
import { Command } from 'commander'
import { clientFrom } from '../context.js'
import type {
  CreateTableRowsResponse,
  DeleteTableRowsResponse,
  GetTableResponse,
  ListTablesResponse,
  QueryRowsResponse,
} from '../generated/v2-api.js'
import { SimApiError } from '../http/client.js'
import { type Column, printList, printRecord, text, timestamp } from '../output/render.js'

type Table = ListTablesResponse['data'][number]
type TableColumn = Table['schema']['columns'][number]
type Row = QueryRowsResponse['data'][number]

const TABLE_COLUMNS: Column<Table>[] = [
  { header: 'id', value: (t) => t.id },
  { header: 'name', value: (t) => t.name },
  { header: 'rows', value: (t) => `${t.rowCount}${t.maxRows ? ` / ${t.maxRows}` : ''}` },
  { header: 'columns', value: (t) => String(t.schema.columns.length) },
  { header: 'updated', value: (t) => timestamp(t.updatedAt) },
]

const COLUMN_COLUMNS: Column<TableColumn>[] = [
  { header: 'name', value: (c) => c.name },
  { header: 'type', value: (c) => c.type },
  { header: 'required', value: (c) => (c.required ? 'yes' : '') },
  { header: 'unique', value: (c) => (c.unique ? 'yes' : '') },
  { header: 'options', value: (c) => (c.options ?? []).map((o) => o.name).join(', ') },
]

/**
 * Parses a `--filter` / `--data` argument.
 *
 * The predicate grammar is a nested object (`{all|any: [{field, op, value}]}`),
 * which has no honest flag encoding — so it is passed as JSON and the parse
 * error names the flag rather than surfacing a bare `SyntaxError`.
 */
function parseJsonArg(value: string, flag: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new SimApiError(`${flag} must be valid JSON: ${(error as Error).message}`, 0)
  }
}

/** `name:desc` / `name` → the wire sort spec. */
function parseSort(specs: string[]): Array<{ field: string; direction: 'asc' | 'desc' }> {
  return specs.map((spec) => {
    const [field, direction = 'asc'] = spec.split(':')
    if (direction !== 'asc' && direction !== 'desc') {
      throw new SimApiError(`Sort direction must be asc or desc, got "${direction}"`, 0)
    }
    if (!field) throw new SimApiError(`Invalid --sort value "${spec}"`, 0)
    return { field, direction }
  })
}

/**
 * Row `data` is name-keyed and user-defined, so the columns are only known at
 * runtime. Union the keys across the page rather than trusting the first row —
 * a sparse row would otherwise hide every column it happens to omit.
 */
function rowColumns(rows: Row[]): Column<Row>[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  return [
    { header: 'id', value: (row) => row.id },
    ...keys.map((key) => ({
      header: key,
      value: (row: Row) => {
        const value = row.data[key]
        if (value === null || value === undefined) return text(null)
        return typeof value === 'object' ? JSON.stringify(value) : String(value)
      },
    })),
  ]
}

export function tablesCommand(): Command {
  const tables = new Command('tables').alias('table').description('Browse and edit tables')

  tables
    .command('list')
    .alias('ls')
    .description('List tables in a workspace')
    .action(async (_options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = (await client.call('listTables', {
        query: { workspaceId: client.requireWorkspace() },
      })) as ListTablesResponse
      printList(profile.output, result.data, TABLE_COLUMNS)
    })

  tables
    .command('get <tableId>')
    .description('Show a table and its schema')
    .action(async (tableId: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = (await client.call('getTable', {
        pathParams: { tableId },
        query: { workspaceId: client.requireWorkspace() },
      })) as GetTableResponse
      const { table } = result.data

      printRecord(
        profile.output,
        [
          ['ID', table.id],
          ['Name', table.name],
          ['Description', text(table.description)],
          ['Rows', `${table.rowCount}${table.maxRows ? ` / ${table.maxRows}` : ''}`],
          ['Columns', table.schema.columns.map((c) => `${c.name}:${c.type}`).join(', ')],
          ['Updated', timestamp(table.updatedAt)],
        ],
        table
      )
    })

  tables
    .command('columns <tableId>')
    .description("Show a table's columns")
    .action(async (tableId: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = (await client.call('getTable', {
        pathParams: { tableId },
        query: { workspaceId: client.requireWorkspace() },
      })) as GetTableResponse
      printList(profile.output, result.data.table.schema.columns, COLUMN_COLUMNS)
    })

  tables
    .command('rows <tableId>')
    .description('List rows, optionally filtered with the predicate grammar')
    .option(
      '--filter <json>',
      'Predicate tree, e.g. \'{"all":[{"field":"status","op":"eq","value":"open"}]}\''
    )
    .option('--sort <field:dir...>', 'Sort spec, e.g. --sort created_at:desc')
    .option('--limit <n>', 'Maximum rows to return', '100')
    .action(
      async (
        tableId: string,
        options: { filter?: string; sort?: string[]; limit: string },
        command: Command
      ) => {
        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const limit = Number.parseInt(options.limit, 10)

        const rows: Row[] = []
        let cursor: string | null = null

        // Always the POST query endpoint, even unfiltered: it is the only shape
        // that carries the predicate, so one path covers both cases instead of
        // two that could format rows differently.
        do {
          const page = (await client.call('queryRows', {
            pathParams: { tableId },
            body: {
              workspaceId,
              ...(options.filter ? { predicate: parseJsonArg(options.filter, '--filter') } : {}),
              ...(options.sort ? { sort: parseSort(options.sort) } : {}),
              limit: Math.min(limit, 1000),
              ...(cursor ? { cursor } : {}),
            },
          })) as QueryRowsResponse
          rows.push(...page.data)
          cursor = page.nextCursor
        } while (cursor && rows.length < limit)

        printList(profile.output, rows.slice(0, limit), rowColumns(rows))
      }
    )

  tables
    .command('insert <tableId>')
    .description('Insert a row')
    .requiredOption('--data <json>', 'Row data, e.g. \'{"name":"Ada","score":9}\'')
    .action(async (tableId: string, options: { data: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const result = (await client.call('createTableRows', {
        pathParams: { tableId },
        body: {
          workspaceId: client.requireWorkspace(),
          data: parseJsonArg(options.data, '--data'),
        },
      })) as CreateTableRowsResponse

      if (profile.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const inserted = 'row' in result.data ? 1 : result.data.rows.length
      console.log(chalk.green(`✓ Inserted ${inserted} row${inserted === 1 ? '' : 's'}`))
    })

  tables
    .command('delete-rows <tableId>')
    .description('Delete rows by id or filter')
    .option('--row <id...>', 'Row ids to delete')
    .option('--filter <json>', 'Predicate tree selecting the rows to delete')
    .option('-y, --yes', 'Skip the confirmation')
    .action(
      async (
        tableId: string,
        options: { row?: string[]; filter?: string; yes?: boolean },
        command: Command
      ) => {
        const { client, profile } = clientFrom(command)

        if (!options.row && !options.filter) {
          // Without this, an argument-less call would delete the whole table.
          throw new SimApiError(
            'Pass --row <id...> or --filter <json> to choose what to delete.',
            0
          )
        }

        if (!options.yes) {
          const target = options.row
            ? `${options.row.length} row${options.row.length === 1 ? '' : 's'}`
            : 'every row matching the filter'
          throw new SimApiError(
            `This deletes ${target} from ${tableId} and cannot be undone. Re-run with --yes to confirm.`,
            0
          )
        }

        const result = (await client.call('deleteTableRows', {
          pathParams: { tableId },
          body: {
            workspaceId: client.requireWorkspace(),
            ...(options.row ? { rowIds: options.row } : {}),
            ...(options.filter ? { filter: parseJsonArg(options.filter, '--filter') } : {}),
          },
        })) as DeleteTableRowsResponse

        if (profile.output === 'json') {
          console.log(JSON.stringify(result, null, 2))
          return
        }
        console.log(chalk.green(`✓ Deleted ${result.data.deletedCount} row(s)`))
        if (result.data.missingRowIds?.length) {
          console.log(chalk.dim(`  Not found: ${result.data.missingRowIds.join(', ')}`))
        }
      }
    )

  return tables
}
