import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  createOracleEpmClient,
  type OracleEpmClient,
} from '@/lib/internal/oracle-epm/client.server'
import { normalizeOracleEpmDestination } from '@/lib/internal/oracle-epm/destination'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import { executeOracleEpmPlanningListApplications } from '@/lib/internal/oracle-epm-planning/operations/list-applications'
import { executeOracleEpmPlanningListCubes } from '@/lib/internal/oracle-epm-planning/operations/list-cubes'
import { executeOracleEpmPlanningListDimensions } from '@/lib/internal/oracle-epm-planning/operations/list-dimensions'
import { executeOracleEpmPlanningListFiles } from '@/lib/internal/oracle-epm-planning/operations/list-files'
import { executeOracleEpmPlanningListJobDefinitions } from '@/lib/internal/oracle-epm-planning/operations/list-job-definitions'
import { PLANNING_INLINE_BYTES } from '@/lib/internal/oracle-epm-planning/route-space'
import { assertPlanningPayload } from '@/lib/internal/oracle-epm-planning/schema'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
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
import type { OracleEpmPlanningAuth } from '@/tools/oracle_epm_planning/types'

type PlanningSelectorKey = Extract<
  ServerSelectorKey,
  | 'oracleEpmPlanning.applications'
  | 'oracleEpmPlanning.cubes'
  | 'oracleEpmPlanning.dimensions'
  | 'oracleEpmPlanning.jobDefinitions'
  | 'oracleEpmPlanning.rules'
  | 'oracleEpmPlanning.rulesets'
  | 'oracleEpmPlanning.files'
>
type PreparedPlanningDestination = OracleEpmPlanningAuth & {
  accessToken: string
  instanceUrl: string
}
const MAX_OPTIONS = 1000
const MAX_PAGES = 20
const PAGE_SIZE = 100

async function preparePlanningDestination(
  args: ExecuteServerSelectorArgs
): Promise<PreparedPlanningDestination> {
  const credential = args.credential
  const access = credential?.access
  if (!credential || !access?.resolvedCredentialId || access.credentialType !== 'service_account') {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const bundle = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  let instanceUrl: string
  try {
    instanceUrl = normalizeOracleEpmDestination(bundle.instanceUrl)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  return {
    oauthCredential: access.resolvedCredentialId,
    accessToken: bundle.accessToken,
    instanceUrl,
  }
}

function requireContext(value: string | undefined): string {
  if (!value || !value.trim() || Buffer.byteLength(value) > 255)
    throw new SelectorContextUnavailableError()
  return value
}

/** Discovery reuses listing operations, with a request-local aggregate serialized-response budget. */
async function executePlanningSelector(
  args: ExecuteServerSelectorArgs,
  auth: PreparedPlanningDestination
) {
  args.signal?.throwIfAborted()
  let responseBytes = 0
  const client = createOracleEpmClient(auth)
  const boundedClient: OracleEpmClient = {
    ...client,
    request: async (endpoint, input) => {
      args.signal?.throwIfAborted()
      const response = await client.request(endpoint, input)
      if ('data' in response) responseBytes += assertPlanningPayload(response.data)
      if (responseBytes > PLANNING_INLINE_BYTES) throw new SelectorOptionsUnavailableError()
      return response
    },
  }
  const context = { client: boundedClient, signal: args.signal }
  const key = args.selectorKey as PlanningSelectorKey
  const options = new Map<string, SafeSelectorOption>()
  let observed = 0
  const add = (id: string, detail?: string) => {
    if (++observed > MAX_OPTIONS || !id.trim() || Buffer.byteLength(id) > 255)
      throw new SelectorOptionsUnavailableError()
    options.set(id, { id, label: id, ...(detail ? { meta: { detail } } : {}) })
  }
  try {
    if (key === 'oracleEpmPlanning.applications') {
      const result = await executeOracleEpmPlanningListApplications(auth, context)
      for (const app of result.output.applications!) add(app.name)
    } else if (key === 'oracleEpmPlanning.files') {
      const result = await executeOracleEpmPlanningListFiles(auth, context)
      for (const file of result.output.files!)
        add(file.name, file.size === null ? file.type : `${file.size} bytes`)
    } else {
      /** Existing selector context slots: projectId = application, planId = cube, objectType = job type. */
      const application = requireContext(args.context.projectId)
      if (key === 'oracleEpmPlanning.cubes') {
        const result = await executeOracleEpmPlanningListCubes({ ...auth, application }, context)
        for (const cube of result.output.cubes!) add(cube.planTypeName)
      } else if (key === 'oracleEpmPlanning.dimensions') {
        const cube = requireContext(args.context.planId)
        let offset = 0
        let complete = false
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await executeOracleEpmPlanningListDimensions(
            { ...auth, application, cube, offset, limit: PAGE_SIZE },
            context
          )
          const dimensions = result.output.dimensions!
          for (const dimension of dimensions) add(dimension.name)
          if (!result.output.hasMore) {
            if (offset + dimensions.length < result.output.totalResults!)
              throw new SelectorOptionsUnavailableError()
            complete = true
            break
          }
          if (dimensions.length === 0 || observed >= MAX_OPTIONS)
            throw new SelectorOptionsUnavailableError()
          offset += dimensions.length
        }
        if (!complete) throw new SelectorOptionsUnavailableError()
      } else {
        const jobType =
          key === 'oracleEpmPlanning.rules'
            ? 'RULES'
            : key === 'oracleEpmPlanning.rulesets'
              ? 'RULESET'
              : requireContext(args.context.objectType)
        const result = await executeOracleEpmPlanningListJobDefinitions(
          { ...auth, application, jobType },
          context
        )
        const jobs = result.output.jobDefinitions!
        if (jobs.length > MAX_OPTIONS) throw new SelectorOptionsUnavailableError()
        for (const job of jobs) if (job.jobType === jobType) add(job.jobName, job.jobType)
      }
    }
    args.signal?.throwIfAborted()
    return flatSelectorResult(
      args.request,
      [...options.values()].sort((a, b) => a.label.localeCompare(b.label)),
      true
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError && error.status !== undefined)
      throw selectorProviderStatusError(error.status)
    if (
      error instanceof SelectorOptionsUnavailableError ||
      error instanceof SelectorContextUnavailableError
    )
      throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['oracle-epm'] } as const
/** Service-account integrations have no OAuth deployment resource mapping; mirror NetSuite's explicit boundary. */
const integrationBlockTypes = ['oracle_epm_planning'] as const
const attachment = definePreparedSelectorAttachment({
  credential,
  integrationBlockTypes,
  destination: { kind: 'credential-bound', prepare: preparePlanningDestination },
  execute: executePlanningSelector,
})
export const oracleEpmPlanningSelectorAttachments = {
  'oracleEpmPlanning.applications': attachment,
  'oracleEpmPlanning.cubes': attachment,
  'oracleEpmPlanning.dimensions': attachment,
  'oracleEpmPlanning.jobDefinitions': attachment,
  'oracleEpmPlanning.rules': attachment,
  'oracleEpmPlanning.rulesets': attachment,
  'oracleEpmPlanning.files': attachment,
} satisfies ServerSelectorAttachmentMap<PlanningSelectorKey>
