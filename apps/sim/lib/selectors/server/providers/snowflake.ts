import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import type { SnowflakeSelectorKind } from '@/tools/snowflake/selector-kinds'
import { buildSelectorStatement } from '@/tools/snowflake/sql'
import {
  buildSnowflakeAuthHeaders,
  normalizeSnowflakeHost,
  readSnowflakeResult,
} from '@/tools/snowflake/utils'

type SnowflakeSelectorKey = Extract<ServerSelectorKey, `snowflake.${string}`>
type SnowflakeScopeLevel = 'account' | 'database' | 'schema'

interface SnowflakeSelectorSpec {
  kind: SnowflakeSelectorKind
  scope: SnowflakeScopeLevel
}

const SNOWFLAKE_SELECTOR_SPECS = {
  'snowflake.databases': { kind: 'databases', scope: 'account' },
  'snowflake.warehouses': { kind: 'warehouses', scope: 'account' },
  'snowflake.roles': { kind: 'roles', scope: 'account' },
  'snowflake.schemas': { kind: 'schemas', scope: 'database' },
  'snowflake.tables': { kind: 'tables', scope: 'schema' },
  'snowflake.fileFormats': { kind: 'file_formats', scope: 'schema' },
  'snowflake.procedures': { kind: 'procedures', scope: 'schema' },
} as const satisfies Record<SnowflakeSelectorKey, SnowflakeSelectorSpec>

const SELECTOR_ROW_LIMIT = 1_000
const SELECTOR_TIMEOUT_SECONDS = 20
const SELECTOR_FETCH_TIMEOUT_MS = (SELECTOR_TIMEOUT_SECONDS + 10) * 1_000

interface SnowflakeObject {
  name: string
  detail: string | null
}

function parseAvailableRoles(cellValue: string | null | undefined): SnowflakeObject[] {
  if (!cellValue) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(cellValue)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((role): role is string => typeof role === 'string' && role.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((role) => ({ name: role, detail: null }))
}

function toOption(object: SnowflakeObject): SafeSelectorOption {
  return {
    id: object.name,
    label: object.detail ? `${object.name} — ${object.detail}` : object.name,
    meta: { name: object.name, ...(object.detail ? { detail: object.detail } : {}) },
  }
}

async function executeSnowflake(args: ExecuteServerSelectorArgs) {
  const spec = SNOWFLAKE_SELECTOR_SPECS[args.selectorKey as SnowflakeSelectorKey]
  if (!spec) throw new SelectorOptionsUnavailableError()
  if (!args.credential) throw new SelectorConnectionUnavailableError()

  const token = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!token.domain) throw new SelectorConnectionUnavailableError()

  let baseUrl: string
  let statement: string
  try {
    baseUrl = normalizeSnowflakeHost(token.domain)
    statement = buildSelectorStatement(
      spec.kind,
      {
        ...(spec.scope !== 'account' ? { database: args.context.database } : {}),
        ...(spec.scope === 'schema' ? { schema: args.context.schema } : {}),
      },
      SELECTOR_ROW_LIMIT
    ).statement
  } catch {
    throw new SelectorOptionsUnavailableError()
  }

  const timeoutSignal = AbortSignal.timeout(SELECTOR_FETCH_TIMEOUT_MS)
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v2/statements`, {
      method: 'POST',
      headers: buildSnowflakeAuthHeaders(token.accessToken),
      body: JSON.stringify({
        statement,
        timeout: SELECTOR_TIMEOUT_SECONDS,
        parameters: { rows_per_resultset: SELECTOR_ROW_LIMIT },
      }),
      signal,
      redirect: 'error',
    })
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }

  try {
    const result = await readSnowflakeResult(response)
    if (!result.result) throw new SelectorOptionsUnavailableError()
    const objects: SnowflakeObject[] =
      spec.kind === 'roles'
        ? parseAvailableRoles(result.result.rows[0]?.[0])
        : result.result.rows.flatMap((row) => {
            const name = row[0]
            if (typeof name !== 'string' || !name) return []
            return [{ name, detail: typeof row[1] === 'string' ? row[1] : null }]
          })
    return flatSelectorResult(args.request, objects.map(toOption), true)
  } catch (error) {
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['snowflake'],
} as const

export const snowflakeSelectorAttachments = {
  'snowflake.databases': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.schemas': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.tables': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.warehouses': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.roles': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.fileFormats': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
  'snowflake.procedures': {
    credential,
    destination: 'credential-bound',
    execute: executeSnowflake,
  },
} satisfies ServerSelectorAttachmentMap<SnowflakeSelectorKey>
