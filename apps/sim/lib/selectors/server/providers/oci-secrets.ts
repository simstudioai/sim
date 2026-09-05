import { createOciClient, type OciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { ociSecretsInputSchema } from '@/lib/internal/oci-secrets/input'
import { executeOciSecretsOperation } from '@/lib/internal/oci-secrets/operations'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type OciSecretsSelectorKey = Extract<ServerSelectorKey, `oci_secrets.${string}`>

async function prepareOciSecretsDestination(args: ExecuteServerSelectorArgs): Promise<OciClient> {
  const access = args.credential?.access
  if (
    !access?.ok ||
    !access.resolvedCredentialId ||
    access.credentialType !== 'service_account' ||
    access.workspaceId !== args.workspaceId
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    return await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      serviceId: 'oci_secrets',
      region: args.context.region,
    })
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

async function executeOciSecretsSelector(args: ExecuteServerSelectorArgs, client: OciClient) {
  const request = requireListRequest(args.selectorKey, args.request)
  const operation = {
    'oci_secrets.vaults': 'list_vaults',
    'oci_secrets.secrets': 'list_secrets',
    'oci_secrets.keys': 'list_keys',
  }[args.selectorKey as OciSecretsSelectorKey]
  const parsed = ociSecretsInputSchema.safeParse({
    operation,
    oauthCredential: args.credential?.access?.resolvedCredentialId,
    compartmentId: args.context.compartmentId,
    vaultId: args.context.vaultId,
    protectionMode: args.context.protectionMode || 'HSM',
    algorithm: 'AES',
    limit: 100,
    page: request.cursor,
  })
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const { output } = await executeOciSecretsOperation(client, parsed.data, args.signal)
    const items =
      operation === 'list_secrets'
        ? (output.secrets ?? []).map((secret) => ({
            id: secret.id,
            label: secret.secretName,
            meta: { lifecycleState: secret.lifecycleState },
          }))
        : operation === 'list_keys'
          ? (output.keys ?? [])
              .filter(
                (key) =>
                  key.lifecycleState === 'ENABLED' &&
                  (key.algorithm == null || key.algorithm === 'AES')
              )
              .map((key) => ({
                id: key.id,
                label: key.displayName,
                meta: { protectionMode: key.protectionMode },
              }))
          : (output.vaults ?? []).map((vault) => ({
              id: vault.id,
              label: vault.displayName,
              meta: { lifecycleState: vault.lifecycleState },
            }))
    return listSelectorResult(items, output.nextPage ?? undefined)
  } catch (error) {
    args.signal?.throwIfAborted()
    throw new SelectorOptionsUnavailableError(
      error instanceof OciClientError && error.status === 429 ? 429 : 502
    )
  }
}

const attachment = definePreparedSelectorAttachment({
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci_secrets'] },
  integrationBlockTypes: ['oci_secrets'],
  destination: { kind: 'credential-bound', prepare: prepareOciSecretsDestination },
  execute: executeOciSecretsSelector,
})

export const ociSecretsSelectorAttachments = {
  'oci_secrets.vaults': attachment,
  'oci_secrets.secrets': attachment,
  'oci_secrets.keys': attachment,
} satisfies ServerSelectorAttachmentMap<OciSecretsSelectorKey>
