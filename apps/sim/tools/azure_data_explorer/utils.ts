import type {
  AzureDataExplorerBaseParams,
  AzureDataExplorerTable,
} from '@/tools/azure_data_explorer/types'

export const AZURE_DATA_EXPLORER_PROXY_URL = '/api/tools/azure_data_explorer/proxy'

export function azureDataExplorerAuthBody(params: AzureDataExplorerBaseParams) {
  return {
    clusterUri: params.clusterUri,
    tenantId: params.tenantId,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    ...(params.resource ? { resource: params.resource } : {}),
  }
}

/** A name Kusto accepts bare, matching the form every documented example uses. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Renders a Kusto entity name for a command string.
 *
 * A plain identifier is emitted bare, exactly as the reference commands are
 * written. A name carrying a space, dot, or dash — the other characters Kusto
 * permits in an identifier — is wrapped in `["..."]`, the documented quoting for
 * names with special characters. The proxy contract restricts names to Kusto's
 * documented character set, so neither form can carry a quote or bracket and no
 * escaping is needed.
 */
export function renderEntityName(name: string): string {
  const trimmed = name.trim()
  return PLAIN_IDENTIFIER.test(trimmed) ? trimmed : `["${trimmed}"]`
}

/** One `name = value` command property, with a quoted, numeric, or bare value. */
const COMMAND_PROPERTY = /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"\\]*"|'[^'\\]*'|[A-Za-z0-9_.:+-]+)$/

/**
 * Splits a property list on the commas that separate properties, ignoring the
 * ones inside a quoted value.
 *
 * A plain `split(',')` would break the documented cases where a value legally
 * contains a comma — a `docstring` sentence, or a `tags` array with more than
 * one entry.
 */
function splitProperties(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (const char of input) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }

  if (quote) throw new Error(`Unterminated ${quote} quote in property list: ${input}`)
  parts.push(current)

  return parts.map((part) => part.trim()).filter(Boolean)
}

/**
 * Builds the `with (...)` clause shared by the create and ingest commands.
 *
 * The clause is interpolated into a command string, so each property is checked
 * against the `name = value` grammar rather than passed through — an
 * unvalidated value could otherwise close the clause and extend the command.
 */
export function buildWithClause(input: string | undefined, example: string): string {
  const trimmed = input?.trim()
  if (!trimmed) return ''

  const inner = trimmed
    .replace(/^with\s*\(/i, '')
    .replace(/\)$/, '')
    .trim()
  if (!inner) return ''

  const properties = splitProperties(inner)
  for (const property of properties) {
    if (!COMMAND_PROPERTY.test(property)) {
      throw new Error(
        `Invalid property "${property}": expected comma-separated name=value pairs, e.g. ${example}`
      )
    }
  }

  return ` with (${properties.join(', ')})`
}

/** The scalar type names and aliases Kusto documents for a column. */
const KUSTO_SCALAR_TYPES = new Set([
  'bool',
  'boolean',
  'datetime',
  'date',
  'decimal',
  'dynamic',
  'guid',
  'uuid',
  'uniqueid',
  'int',
  'long',
  'real',
  'double',
  'string',
  'timespan',
  'time',
])

const COLUMN_NAME = /^[\p{L}\p{N}_ .-]+$/u

/**
 * Renders a CSL column schema — `Timestamp:datetime, Level:string` — for a
 * create command.
 *
 * Each column name goes through {@link renderEntityName} and each type is
 * checked against Kusto's documented scalar types, so the schema cannot carry
 * anything that would extend the command.
 */
export function renderColumnSchema(schema: string): string {
  const columns = schema
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)

  if (columns.length === 0) {
    throw new Error('Column schema is required, e.g. Timestamp:datetime, Level:string')
  }

  return columns
    .map((column) => {
      const separator = column.lastIndexOf(':')
      if (separator <= 0) {
        throw new Error(
          `Invalid column "${column}": expected name:type pairs, e.g. Timestamp:datetime, Level:string`
        )
      }
      const name = column.slice(0, separator).trim()
      const type = column
        .slice(separator + 1)
        .trim()
        .toLowerCase()

      if (!COLUMN_NAME.test(name)) {
        throw new Error(
          `Invalid column name "${name}": may contain only letters, digits, underscores, spaces, dots, and dashes`
        )
      }
      if (!KUSTO_SCALAR_TYPES.has(type)) {
        throw new Error(
          `Unknown column type "${type}" for column "${name}": expected one of ${[...KUSTO_SCALAR_TYPES].join(', ')}`
        )
      }
      return `${renderEntityName(name)}:${type}`
    })
    .join(', ')
}

/** The four documented ingest-from-query commands. */
const INGEST_MODE_COMMANDS = {
  set: '.set',
  append: '.append',
  'set-or-append': '.set-or-append',
  'set-or-replace': '.set-or-replace',
} as const

export type AzureDataExplorerIngestMode = keyof typeof INGEST_MODE_COMMANDS

/**
 * Maps an ingest mode onto its command word. Unknown modes are rejected rather
 * than passed through, since the word leads the command string.
 */
export function renderIngestMode(mode: string | undefined): string {
  const key = (mode?.trim() || 'set-or-append') as AzureDataExplorerIngestMode
  const command = INGEST_MODE_COMMANDS[key]
  if (!command) {
    throw new Error(
      `Unknown ingest mode "${mode}": expected one of ${Object.keys(INGEST_MODE_COMMANDS).join(', ')}`
    )
  }
  return command
}

/**
 * Kusto operation IDs are GUIDs. The `.show operations` and
 * `.show ingestion failures` syntax lines take the ID as a bare argument, so it
 * is emitted unquoted and restricted to GUID characters.
 */
const OPERATION_ID = /^[0-9a-fA-F-]{1,64}$/

export function renderOperationId(operationId: string): string {
  const trimmed = operationId.trim()
  if (!OPERATION_ID.test(trimmed)) {
    throw new Error(`Invalid operation ID "${operationId}": expected a GUID`)
  }
  return trimmed
}

interface ProxyEnvelope {
  success?: boolean
  output?: AzureDataExplorerTable
  error?: string
}

async function readProxyEnvelope(response: Response): Promise<AzureDataExplorerTable> {
  const data = (await response.json().catch(() => ({}))) as ProxyEnvelope

  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Azure Data Explorer request failed: HTTP ${response.status}`)
  }

  return (
    data.output ?? {
      tableName: null,
      columns: [],
      rows: [],
      records: [],
      rowCount: 0,
      totalRowCount: 0,
      truncated: false,
    }
  )
}

export async function transformAzureDataExplorerResponse(response: Response) {
  return { success: true as const, output: await readProxyEnvelope(response) }
}

/**
 * Adds a flat list of the strings in one documented column, so a `.show` or
 * `.ingest` command surfaces its identifiers alongside the full result table.
 *
 * Every string value is kept, including an empty one: `.ingest inline` reports
 * "no data shards were generated" as a single record carrying an empty
 * (zero-valued) extent ID, so dropping it would turn a no-op load into what
 * looks like a missing column.
 */
export function transformColumnListResponse<K extends string>(columnName: string, outputKey: K) {
  return async (response: Response) => {
    const output = await readProxyEnvelope(response)
    const values = output.records
      .map((record) => record[columnName])
      .filter((value): value is string => typeof value === 'string')
    return {
      success: true as const,
      output: { ...output, [outputKey]: values } as AzureDataExplorerTable & Record<K, string[]>,
    }
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Projects `.show table ... cslschema`, whose single row carries the documented
 * TableName, Schema, DatabaseName, Folder, and DocString columns.
 */
export async function transformTableSchemaResponse(response: Response) {
  const output = await readProxyEnvelope(response)
  const record = output.records[0] ?? {}
  return {
    success: true as const,
    output: {
      tableName: stringOrNull(record.TableName),
      schema: stringOrNull(record.Schema),
      databaseName: stringOrNull(record.DatabaseName),
      folder: stringOrNull(record.Folder),
      docString: stringOrNull(record.DocString),
    },
  }
}
