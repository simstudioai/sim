import { Command, Option } from 'commander'
import { clientFrom } from '../context.js'
import { CLI_CONTRACT } from '../contract/commands.js'
import type { ColumnSpec, CommandSpec } from '../contract/types.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { SimApiError, type V2Page } from '../http/client.js'
import {
  bytes,
  type Column,
  duration,
  printList,
  printRecord,
  sanitize,
  text,
  timestamp,
} from '../output/render.js'
import { deriveCommandPath } from './derive.js'
import {
  buildRequest,
  type FieldSpec,
  flagNameFor,
  flagSpecFor,
  PROFILE_INJECTED_FIELD,
  takesJson,
} from './request.js'

/** Default page size when a list command is run without `--limit`. */
const DEFAULT_LIMIT = 100

/** Reads `a.b.c` out of a row, tolerating a missing link anywhere along the way. */
function at(row: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as never)[key] : undefined),
      row
    )
}

function renderCell(value: unknown, format: ColumnSpec['format']): string {
  switch (format) {
    case 'timestamp':
      return timestamp(value as string | null)
    case 'bytes':
      return bytes(value as number | null)
    case 'duration':
      return duration(value as number | null)
    case 'bool':
      return value === null || value === undefined ? text(null) : value ? 'yes' : 'no'
    case 'cost':
      return typeof value === 'number' ? `$${value.toFixed(4)}` : text(null)
    default:
      if (value === null || value === undefined || value === '') return text(null)
      // Server-supplied: strip terminal control sequences before it can reach a tty.
      return sanitize(typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
}

function columnsFrom(specs: ColumnSpec[]): Column<unknown>[] {
  return specs.map((spec) => ({
    header: spec.header,
    value: (row: unknown) => renderCell(at(row, spec.path ?? spec.header), spec.format),
  }))
}

/**
 * Columns for a list command with none declared in the contract.
 *
 * Row shapes are only known at runtime here — a table's `data` is user-defined —
 * so the keys are unioned across the page rather than read off the first row,
 * which would let a sparse row hide every column it happens to omit. Nested
 * values are skipped: they render as JSON blobs and make the table unreadable.
 */
function inferColumns(rows: unknown[]): Column<unknown>[] {
  const keys: string[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const [key, value] of Object.entries(row)) {
      if (seen.has(key)) continue
      if (value !== null && typeof value === 'object') continue
      seen.add(key)
      keys.push(key)
    }
  }

  return keys.map((key) => ({
    // The key itself is remote data when the rows are user-defined, and the
    // header is printed just like a cell — sanitizing values but not headers
    // left the same control sequences executable one row higher.
    header: sanitize(key),
    value: (row: unknown) => renderCell(at(row, key), 'auto'),
  }))
}

/** The operation's one-line help, taken from the OpenAPI summary at generation time. */
function summaryFor(operation: V2OperationName): string | undefined {
  return (V2_OPERATIONS[operation] as { summary?: string }).summary
}

/**
 * Which request slot carries the pagination cursor, or null for a non-list
 * operation.
 *
 * Both slots have to be checked: most lists take `cursor` as a query param, but
 * `queryRows` is a POST whose whole filter — cursor included — is in the body.
 * Looking only at the query made it fall through to the single-request path,
 * which then rendered its array of rows through `printRecord` and printed
 * nothing at all, and never auto-paged.
 */
function cursorSlot(operation: V2OperationName): 'query' | 'body' | null {
  const spec = V2_OPERATIONS[operation] as {
    query?: Record<string, FieldSpec>
    body?: Record<string, FieldSpec>
  }
  if (spec.query && 'cursor' in spec.query) return 'query'
  if (spec.body && 'cursor' in spec.body) return 'body'
  return null
}

/** Adds the flags a field needs, or nothing when the contract omits it. */
function addFieldOption(
  command: Command,
  operation: V2OperationName,
  field: string,
  descriptor: FieldSpec
): void {
  // Never a flag: it comes from the profile, and `cursor`/`limit` are owned by
  // the auto-pager rather than exposed as raw request fields.
  if (field === PROFILE_INJECTED_FIELD || field === 'cursor') return

  const flag = flagSpecFor(operation, field)
  if (flag.omit) return

  const name = flagNameFor(operation, field)
  const short = flag.short ? `-${flag.short}, ` : ''

  if (field === 'limit') {
    command.option(
      `--limit <n>`,
      'Maximum items to return (0 for everything)',
      String(DEFAULT_LIMIT)
    )
    return
  }

  if (descriptor.kind === 'boolean') {
    command.option(`${short}--${name}`, flag.describe ?? `Set ${field}`)
    return
  }

  const takesList = flag.list === true
  const placeholder = takesList ? `<value...>` : takesJson(descriptor, flag) ? `<json>` : `<value>`
  const describe =
    flag.describe ??
    (descriptor.values ? `One of: ${descriptor.values.join(', ')}` : `Set ${field}`)

  const option = new Option(`${short}--${name} ${placeholder}`, describe)
  if (descriptor.values && !takesList) option.choices([...descriptor.values])
  if (descriptor.default !== undefined && field !== 'limit') {
    option.default(undefined, String(descriptor.default))
  }
  command.addOption(option)
}

/**
 * Builds one leaf command for an operation.
 *
 * The action closure is the whole runtime: coerce and assemble the request,
 * auto-page it when the response is a cursor list, then render through whatever
 * the contract says about columns.
 */
function buildLeaf(operation: V2OperationName, spec: CommandSpec, leafName: string): Command {
  const operationSpec = V2_OPERATIONS[operation] as {
    method: string
    pathParams: readonly string[]
    query?: Record<string, FieldSpec>
    body?: Record<string, FieldSpec>
  }

  // `new Command('upsert <tableId>')` would make the whole string the command's
  // NAME, so `sim tables upsert` would never match it and would silently fall
  // through to the group's help. Arguments have to be declared separately.
  const command = new Command(leafName)
  for (const param of operationSpec.pathParams) {
    command.argument(`<${param}>`)
  }

  command.description(
    spec.describe ??
      summaryFor(operation) ??
      `${operationSpec.method} ${V2_OPERATIONS[operation].path}`
  )

  for (const slot of ['query', 'body'] as const) {
    for (const [field, descriptor] of Object.entries(operationSpec[slot] ?? {})) {
      addFieldOption(command, operation, field, descriptor)
    }
  }

  if (spec.confirm) {
    command.option('-y, --yes', 'Skip the confirmation')
  }

  command.action(async (...invocation: unknown[]) => {
    // commander passes positionals, then the options object, then the Command.
    const host = invocation[invocation.length - 1] as Command
    const flags = invocation[invocation.length - 2] as Record<string, unknown>
    const positional = invocation.slice(0, operationSpec.pathParams.length) as string[]

    if (spec.confirm && !flags.yes) {
      throw new SimApiError(`${spec.confirm} Re-run with --yes to confirm.`, 0)
    }

    const { client, profile } = clientFrom(host)
    // `requireWorkspace` checks the key first on purpose, so a fresh install is
    // told to log in rather than to set a workspace it cannot use yet. Reading
    // `profile.workspaceId` directly skipped that ordering.
    const needsWorkspace = Boolean(
      (operationSpec.query && PROFILE_INJECTED_FIELD in operationSpec.query) ||
        (operationSpec.body && PROFILE_INJECTED_FIELD in operationSpec.body)
    )
    const request = buildRequest(
      operation,
      positional,
      flags,
      needsWorkspace ? client.requireWorkspace() : profile.workspaceId
    )

    const paging = cursorSlot(operation)
    if (paging) {
      const rawLimit = Number.parseInt(String(flags.limit ?? DEFAULT_LIMIT), 10)
      if (Number.isNaN(rawLimit) || rawLimit < 0) {
        throw new SimApiError('--limit must be a non-negative number', 0)
      }
      // 0 means everything; Infinity lets the loop run until the cursor dries up.
      const limit = rawLimit === 0 ? Number.POSITIVE_INFINITY : rawLimit

      const rows: unknown[] = []
      let cursor: string | null = null
      do {
        // The cursor goes back in whichever slot the contract declared it.
        const page: V2Page<unknown> = await client.request(request.path, {
          method: operationSpec.method as 'GET' | 'POST',
          query: paging === 'query' ? { ...request.query, cursor } : request.query,
          body:
            paging === 'body'
              ? { ...(request.body ?? {}), ...(cursor ? { cursor } : {}) }
              : request.body,
        })
        rows.push(...page.data)
        cursor = page.nextCursor
      } while (cursor && rows.length < limit)

      const page = Number.isFinite(limit) ? rows.slice(0, limit) : rows
      printList(profile.output, page, spec.columns ? columnsFrom(spec.columns) : inferColumns(page))
      return
    }

    const result = await client.request<{ data?: unknown }>(request.path, {
      method: operationSpec.method as 'GET' | 'POST',
      query: request.query,
      body: request.body,
    })
    const data = result?.data ?? result

    if (Array.isArray(data)) {
      // Reached when a non-paginated operation answers with a collection.
      // `printRecord` would silently print nothing for an array.
      printList(profile.output, data, spec.columns ? columnsFrom(spec.columns) : inferColumns(data))
      return
    }

    const fields: Array<[string, string]> =
      data && typeof data === 'object' && !Array.isArray(data)
        ? Object.entries(data)
            .filter(([, value]) => value === null || typeof value !== 'object')
            .map(([key, value]) => [key, renderCell(value, 'auto')])
        : []

    printRecord(profile.output, fields, data)
  })

  return command
}

/**
 * Builds every command the contract and the generated operation table describe.
 *
 * Iterates `V2_OPERATIONS`, not the contract — an operation added to a Zod
 * contract shows up here after `generate:cli-api` with no CLI edit at all. The
 * contract is consulted only for the things a schema cannot say.
 *
 * `reserved` are groups owned by hand-written commands (`files download` streams
 * binary, `logs get` prints a trace). A generated leaf never displaces one.
 */
export function buildGeneratedCommands(reserved: ReadonlySet<string>): Command[] {
  const groups = new Map<string, Command>()

  for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
    const spec = CLI_CONTRACT[operation] ?? {}
    if (spec.hidden) continue
    // Non-JSON responses (binary downloads) need a bespoke consumer.
    if (V2_OPERATIONS[operation].responseMode !== 'json') continue

    const segments = spec.command ? spec.command.split(' ') : deriveCommandPath(operation)
    const [groupName, ...rest] = segments
    const leafName = rest.join(' ') || 'run'

    if (reserved.has(`${groupName} ${leafName}`)) continue

    let group = groups.get(groupName)
    if (!group) {
      group = new Command(groupName)
      groups.set(groupName, group)
    }

    // A multi-word leaf (`rows batch-delete`) nests one more level so help reads
    // as a tree rather than a flat list of hyphenated names.
    if (rest.length > 1) {
      const [subName, ...tail] = rest
      let sub = group.commands.find((candidate) => candidate.name() === subName)
      if (!sub) {
        sub = new Command(subName)
        group.addCommand(sub)
      }
      sub.addCommand(buildLeaf(operation, spec, tail.join(' ')))
      continue
    }

    group.addCommand(buildLeaf(operation, spec, leafName))
  }

  return [...groups.values()].sort((a, b) => a.name().localeCompare(b.name()))
}
