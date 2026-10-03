import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  createOracleEpmClient,
  type OracleEpmClient,
} from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import { listRepositoryFiles } from '@/lib/internal/oracle-epm-platform/files.server'
import { identityToolHandlers } from '@/lib/internal/oracle-epm-platform/operations/identity'
import type { OracleEpmPlatformInput } from '@/lib/internal/oracle-epm-platform/schemas'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type OracleEpmPlatformSelectorKey = Extract<
  ServerSelectorKey,
  | 'oracle_epm_platform.files'
  | 'oracle_epm_platform.snapshots'
  | 'oracle_epm_platform.groups'
  | 'oracle_epm_platform.roles'
>

interface PreparedDestination {
  client: OracleEpmClient
  auth: OracleEpmPlatformInput<'get_environment_info'>
}

async function prepareDestination(args: ExecuteServerSelectorArgs): Promise<PreparedDestination> {
  const credential = args.credential
  const access = credential?.access
  if (!credential || access?.credentialType !== 'service_account' || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const token = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  args.signal?.throwIfAborted()
  try {
    const auth = {
      oauthCredential: access.resolvedCredentialId,
      accessToken: token.accessToken,
      instanceUrl: token.instanceUrl,
    }
    return { auth, client: createOracleEpmClient(auth) }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

function options(items: { name: string; detail?: string }[]): SafeSelectorOption[] {
  const result = new Map<string, SafeSelectorOption>()
  for (const item of items) {
    if (!item.name.trim() || item.name.length > 512) throw new SelectorOptionsUnavailableError()
    result.set(item.name, {
      id: item.name,
      label: item.name,
      ...(item.detail ? { meta: { detail: item.detail } } : {}),
    })
  }
  return [...result.values()].sort((a, b) => a.label.localeCompare(b.label))
}

async function execute(args: ExecuteServerSelectorArgs, prepared: PreparedDestination) {
  args.signal?.throwIfAborted()
  const context = { client: prepared.client, signal: args.signal }
  try {
    let items: SafeSelectorOption[]
    switch (args.selectorKey) {
      case 'oracle_epm_platform.files':
      case 'oracle_epm_platform.snapshots': {
        const files = await listRepositoryFiles(prepared.client, args.signal)
        items = options(
          files
            .filter(
              (file) => args.selectorKey !== 'oracle_epm_platform.snapshots' || file.type === 'LCM'
            )
            .map((file) => ({
              name: file.name,
              detail:
                file.size === null ? 'Migration snapshot; size unavailable' : `${file.size} bytes`,
            }))
        )
        break
      }
      case 'oracle_epm_platform.groups': {
        const result = await identityToolHandlers.list_groups(prepared.auth, context)
        items = options(
          result.groups.map((group) => ({
            name: group.groupname,
            detail: group.type,
          }))
        )
        break
      }
      case 'oracle_epm_platform.roles': {
        const result = await identityToolHandlers.list_roles(prepared.auth, context)
        // The mutation APIs accept the role NAME, not its HP/HUB identifier.
        items = options(result.roles.map((role) => ({ name: role.name, detail: role.id })))
        break
      }
      default:
        throw new SelectorOptionsUnavailableError()
    }
    return flatSelectorResult(args.request, items, true)
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError) throw selectorProviderStatusError(error.status ?? 502)
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle-epm-platform'],
} as const
// Like NetSuite, the API-key catalog class requires an explicit block allowlist binding.
const integrationBlockTypes = ['oracle_epm_platform'] as const
export const oracleEpmPlatformSelectorAttachments = {
  'oracle_epm_platform.files': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute,
  }),
  'oracle_epm_platform.snapshots': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute,
  }),
  'oracle_epm_platform.groups': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute,
  }),
  'oracle_epm_platform.roles': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute,
  }),
} satisfies ServerSelectorAttachmentMap<OracleEpmPlatformSelectorKey>
