import { requestJson } from '@/lib/api/client/request'
import { snowflakeObjectsSelectorContract } from '@/lib/api/contracts/selectors/snowflake'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'
import type { SnowflakeSelectorKind } from '@/tools/snowflake/selector-kinds'

type SnowflakeSelectorKey = Extract<SelectorKey, `snowflake.${string}`>

/** What each picker needs in scope before it can list anything. */
type SnowflakeSelectorScopeLevel = 'account' | 'database' | 'schema'

interface SnowflakeSelectorSpec {
  kind: SnowflakeSelectorKind
  scope: SnowflakeSelectorScopeLevel
}

const SNOWFLAKE_SELECTOR_SPECS: Record<SnowflakeSelectorKey, SnowflakeSelectorSpec> = {
  'snowflake.databases': { kind: 'databases', scope: 'account' },
  'snowflake.warehouses': { kind: 'warehouses', scope: 'account' },
  'snowflake.roles': { kind: 'roles', scope: 'account' },
  'snowflake.schemas': { kind: 'schemas', scope: 'database' },
  'snowflake.tables': { kind: 'tables', scope: 'schema' },
  'snowflake.fileFormats': { kind: 'file_formats', scope: 'schema' },
  'snowflake.procedures': { kind: 'procedures', scope: 'schema' },
}

/**
 * Snowflake object names are the values the tools send back as identifiers, so
 * the option id IS the name. The detail column is shown only when it adds
 * something the name doesn't already say.
 */
function toOption(object: { name: string; detail: string | null }): SelectorOption {
  return {
    id: object.name,
    label: object.detail ? `${object.name} — ${object.detail}` : object.name,
    meta: { name: object.name, ...(object.detail ? { detail: object.detail } : {}) },
  }
}

function scopeSatisfied(spec: SnowflakeSelectorSpec, args: SelectorQueryArgs): boolean {
  const { context } = args
  if (!context.oauthCredential) return false
  if (spec.scope === 'account') return true
  if (!context.database) return false
  return spec.scope === 'database' || Boolean(context.schema)
}

function buildSelector(key: SnowflakeSelectorKey): SelectorDefinition {
  const spec = SNOWFLAKE_SELECTOR_SPECS[key]

  const fetchObjects = async ({ context, signal }: SelectorQueryArgs) => {
    const credentialId = ensureCredential(context, key)
    const data = await requestJson(snowflakeObjectsSelectorContract, {
      body: {
        credential: credentialId,
        workflowId: context.workflowId,
        kind: spec.kind,
        database: spec.scope === 'account' ? undefined : context.database,
        schema: spec.scope === 'schema' ? context.schema : undefined,
      },
      signal,
    })
    return data.objects
  }

  return {
    key,
    contracts: [snowflakeObjectsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      key,
      context.oauthCredential ?? 'none',
      context.database ?? 'none',
      context.schema ?? 'none',
    ],
    enabled: (args: SelectorQueryArgs) => scopeSatisfied(spec, args),
    fetchList: async (args: SelectorQueryArgs) => (await fetchObjects(args)).map(toOption),
    fetchById: async (args: SelectorQueryArgs) => {
      if (!args.detailId || !scopeSatisfied(spec, args)) return null
      const match = (await fetchObjects(args)).find((object) => object.name === args.detailId)
      return match ? toOption(match) : null
    },
    // Snowflake exposes no lookup-by-name endpoint; `fetchById` filters the
    // same listing, so an id that does not exist resolves to null rather than
    // erroring.
    resolvesUnknownIds: true,
  }
}

export const snowflakeSelectors = {
  'snowflake.databases': buildSelector('snowflake.databases'),
  'snowflake.schemas': buildSelector('snowflake.schemas'),
  'snowflake.tables': buildSelector('snowflake.tables'),
  'snowflake.warehouses': buildSelector('snowflake.warehouses'),
  'snowflake.roles': buildSelector('snowflake.roles'),
  'snowflake.fileFormats': buildSelector('snowflake.fileFormats'),
  'snowflake.procedures': buildSelector('snowflake.procedures'),
} satisfies Record<SnowflakeSelectorKey, SelectorDefinition>
