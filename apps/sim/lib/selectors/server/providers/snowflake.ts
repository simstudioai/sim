import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { definePreparedSelectorAttachment } from '@/lib/selectors/server/types'
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

interface SnowflakeDestination {
  accessToken: string
  baseUrl: string
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

async function prepareSnowflakeDestination(
  args: ExecuteServerSelectorArgs
): Promise<SnowflakeDestination> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  if (!token.domain) throw new SelectorConnectionUnavailableError()
  try {
    return {
      accessToken: token.accessToken,
      baseUrl: normalizeSnowflakeHost(token.domain),
    }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeSnowflake(
  args: ExecuteServerSelectorArgs,
  destination: SnowflakeDestination
) {
  const spec = SNOWFLAKE_SELECTOR_SPECS[args.selectorKey as SnowflakeSelectorKey]
  if (!spec) throw new SelectorOptionsUnavailableError()

  let statement: string
  try {
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
    response = await fetch(`${destination.baseUrl}/api/v2/statements`, {
      method: 'POST',
      headers: buildSnowflakeAuthHeaders(destination.accessToken),
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

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw selectorProviderStatusError(response.status)
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

/**
 * The integration this selector reaches. Declared rather than derived: Snowflake is an
 * API-key integration with no entry in the deployment OAuth catalog, so its
 * service id maps to no block type and the allowlist would have nothing to
 * judge it on.
 */
const integrationBlockTypes = ['snowflake'] as const

export const snowflakeSelectorAttachments = {
  'snowflake.databases': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.schemas': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.tables': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.warehouses': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.roles': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.fileFormats': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
  'snowflake.procedures': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareSnowflakeDestination },
    execute: executeSnowflake,
  }),
} satisfies ServerSelectorAttachmentMap<SnowflakeSelectorKey>
