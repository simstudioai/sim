import { isPlainRecord } from '@sim/utils/object'
import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { normalizeOracleEpmDestination, OracleEpmError } from '@/lib/internal/oracle-epm'
import {
  executeFccsGetDimensionOperation,
  executeFccsListApplicationsOperation,
  executeFccsListCubesOperation,
  executeFccsListDimensionsOperation,
  executeFccsListFilesOperation,
  executeFccsListJobDefinitionsOperation,
} from '@/lib/internal/oracle-epm-fccs/operations'
import {
  assertFccsHierarchyBudget,
  fccsHierarchySchema,
  fccsJobType,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
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
import type { FccsAuthParams } from '@/tools/oracle_epm_fccs/types'
import type { ToolResponse } from '@/tools/types'

type FccsSelectorKey = Extract<ServerSelectorKey, `oracleEpmFccs.${string}`>
type PreparedFccsDestination = FccsAuthParams & { instanceUrl: string }

async function prepareFccsDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedFccsDestination> {
  args.signal?.throwIfAborted()
  const credential = args.credential
  const id = credential?.access?.resolvedCredentialId
  if (!credential || !id || credential.access?.credentialType !== 'service_account')
    throw new SelectorConnectionUnavailableError()
  const resolved = await resolveOAuthAccountId(id)
  args.signal?.throwIfAborted()
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  )
    throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  try {
    return {
      oauthCredential: id,
      accessToken: token.accessToken,
      instanceUrl: normalizeOracleEpmDestination(token.instanceUrl),
    }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

function required(value: string | undefined): string {
  if (!value || !value.trim() || value.length > 255) throw new SelectorContextUnavailableError()
  return value
}

function outputItems(result: ToolResponse): Record<string, unknown>[] {
  if (
    !result.success ||
    !Array.isArray(result.output.items) ||
    !result.output.items.every(isPlainRecord)
  )
    throw new SelectorOptionsUnavailableError()
  if (result.output.items.length > MAX_SELECTOR_OPTIONS || result.output.hasMore === true)
    throw new SelectorOptionsUnavailableError()
  return result.output.items
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new SelectorOptionsUnavailableError()
  return value
}

/** Flat results are complete within the advertised budget, or fail with manual fallback; never truncate silently. */
export function flattenFccsMembers(value: unknown): SafeSelectorOption[] {
  assertFccsHierarchyBudget(value)
  const root = fccsHierarchySchema.parse(value)
  const stack = [root]
  const options = new Map<string, SafeSelectorOption>()
  while (stack.length) {
    const member = stack.pop()!
    if (!options.has(member.name))
      options.set(member.name, {
        id: member.name,
        label: member.alias ? `${member.name} (${member.alias})` : member.name,
        ...(member.path ? { meta: { path: member.path } } : {}),
      })
    /** Preserve Oracle's first occurrence (and its alias) when a shared member repeats. */
    if (member.children) {
      for (let index = member.children.length - 1; index >= 0; index -= 1)
        stack.push(member.children[index])
    }
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label))
}

const definitionTypes: Record<string, string> = {
  oracle_epm_fccs_export_application_data: 'EXPORT_DATA',
  oracle_epm_fccs_import_application_data: 'IMPORT_DATA',
  oracle_epm_fccs_export_metadata: 'EXPORT_METADATA',
  oracle_epm_fccs_import_metadata: 'IMPORT_METADATA',
  oracle_epm_fccs_import_exchange_rates: 'IMPORT_EXCHANGE_RATES',
}

async function listOptions(
  args: ExecuteServerSelectorArgs,
  auth: PreparedFccsDestination
): Promise<SafeSelectorOption[]> {
  const key = args.selectorKey
  const signal = args.signal
  signal?.throwIfAborted()
  if (key === 'oracleEpmFccs.applications') {
    return outputItems(await executeFccsListApplicationsOperation(auth, signal)).map((item) => ({
      id: name(item.name),
      label: name(item.name),
      ...(typeof item.appType === 'string' ? { meta: { appType: item.appType } } : {}),
    }))
  }
  if (key === 'oracleEpmFccs.files') {
    return outputItems(await executeFccsListFilesOperation(auth, signal)).map((item) => ({
      id: name(item.name),
      label: name(item.name),
      ...(typeof item.size === 'string' ? { meta: { sizeBytes: item.size } } : {}),
    }))
  }
  /** Manifest sourceFields aliases product inputs onto existing shared wire-context slots. */
  const application = required(args.context.database)
  if (key === 'oracleEpmFccs.cubes') {
    return outputItems(await executeFccsListCubesOperation({ ...auth, application }, signal)).map(
      (item) => ({ id: name(item.planTypeName), label: name(item.cubeName ?? item.planTypeName) })
    )
  }
  if (
    key === 'oracleEpmFccs.rules' ||
    key === 'oracleEpmFccs.ruleSets' ||
    key === 'oracleEpmFccs.jobDefinitions'
  ) {
    const jobType =
      key === 'oracleEpmFccs.rules'
        ? 'RULES'
        : key === 'oracleEpmFccs.ruleSets'
          ? 'RULESET'
          : (definitionTypes[args.context.environmentType ?? ''] ?? args.context.objectType)
    if (!jobType || !fccsJobType.safeParse(jobType).success)
      throw new SelectorContextUnavailableError()
    return outputItems(
      await executeFccsListJobDefinitionsOperation({ ...auth, application, jobType }, signal)
    )
      .filter((item) => item.jobType === jobType)
      .map((item) => ({
        id: name(item.jobName),
        label: name(item.jobName),
        meta: { jobType: name(item.jobType) },
      }))
  }
  const cube = required(args.context.planId)
  if (key === 'oracleEpmFccs.dimensions') {
    return outputItems(
      await executeFccsListDimensionsOperation({ ...auth, application, cube, limit: 1000 }, signal)
    ).map((item) => ({
      id: name(item.name),
      label: name(item.name),
      ...(typeof item.dimType === 'string' ? { meta: { dimType: item.dimType } } : {}),
    }))
  }
  const dimensionType =
    key === 'oracleEpmFccs.periods'
      ? 'Period'
      : key === 'oracleEpmFccs.entities'
        ? 'Entity'
        : key === 'oracleEpmFccs.scenarios'
          ? 'Scenario'
          : undefined
  let dimension: string
  if (dimensionType) {
    const dimensions = outputItems(
      await executeFccsListDimensionsOperation(
        { ...auth, application, cube, limit: 1000, filter: { dimType: dimensionType } },
        signal
      )
    )
    const matching = dimensions.filter((item) => item.dimType === dimensionType)
    if (matching.length !== 1) throw new SelectorOptionsUnavailableError()
    dimension = name(matching[0].name)
  } else {
    dimension = required(args.context.objectType)
  }
  const result = await executeFccsGetDimensionOperation(
    { ...auth, application, cube, dimension },
    signal
  )
  if (!result.success) throw new SelectorOptionsUnavailableError()
  return flattenFccsMembers(result.output)
}

async function executeFccsSelector(args: ExecuteServerSelectorArgs, auth: PreparedFccsDestination) {
  try {
    if (args.request.kind === 'list' && args.request.cursor)
      throw new SelectorOptionsUnavailableError()
    const options = await listOptions(args, auth)
    args.signal?.throwIfAborted()
    const search =
      args.request.kind === 'list' ? args.request.search?.toLocaleLowerCase() : undefined
    if (search && search.length > 255) throw new SelectorContextUnavailableError()
    return flatSelectorResult(
      args.request,
      search
        ? options.filter(
            (option) =>
              option.label.toLocaleLowerCase().includes(search) ||
              option.id.toLocaleLowerCase().includes(search)
          )
        : options,
      true
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError) throw selectorProviderStatusError(error.status ?? 502)
    if (
      error instanceof SelectorContextUnavailableError ||
      error instanceof SelectorOptionsUnavailableError ||
      error instanceof SelectorConnectionUnavailableError
    )
      throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const attachment = definePreparedSelectorAttachment({
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle-epm-fccs'] },
  integrationBlockTypes: ['oracle_epm_fccs'],
  destination: { kind: 'credential-bound', prepare: prepareFccsDestination },
  execute: executeFccsSelector,
})

export const oracleEpmFccsSelectorAttachments = {
  'oracleEpmFccs.applications': attachment,
  'oracleEpmFccs.cubes': attachment,
  'oracleEpmFccs.dimensions': attachment,
  'oracleEpmFccs.members': attachment,
  'oracleEpmFccs.periods': attachment,
  'oracleEpmFccs.entities': attachment,
  'oracleEpmFccs.scenarios': attachment,
  'oracleEpmFccs.rules': attachment,
  'oracleEpmFccs.ruleSets': attachment,
  'oracleEpmFccs.jobDefinitions': attachment,
  'oracleEpmFccs.files': attachment,
} satisfies ServerSelectorAttachmentMap<FccsSelectorKey>
