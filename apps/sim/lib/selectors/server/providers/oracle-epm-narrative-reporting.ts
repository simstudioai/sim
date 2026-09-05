import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  createOracleEpmClient,
  type OracleEpmClient,
} from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import {
  getBook,
  getLibraryArtifact,
  getReport,
  listBooks,
  listLibraryArtifacts,
  listReports,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import {
  type NarrativeAuth,
  narrativeListInputSchema,
  narrativeResourceInputSchema,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

interface PreparedDestination {
  auth: NarrativeAuth
  client: OracleEpmClient
}
const PAGE_SIZE = 50
const MAX_OFFSET = 5_000

async function prepare(args: ExecuteServerSelectorArgs): Promise<PreparedDestination> {
  args.signal?.throwIfAborted()
  const credential = args.credential
  if (
    !credential?.access?.resolvedCredentialId ||
    credential.access.credentialType !== 'service_account' ||
    credential.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const token = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  args.signal?.throwIfAborted()
  if (!token.instanceUrl) throw new SelectorConnectionUnavailableError()
  const auth = {
    oauthCredential: credential.access.resolvedCredentialId,
    accessToken: token.accessToken,
    instanceUrl: token.instanceUrl,
  }
  try {
    return { auth, client: createOracleEpmClient(auth) }
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
}

function cursorOffset(cursor?: string): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9][0-9]{0,3})$/.test(cursor)) throw new SelectorOptionsUnavailableError()
  const value = Number(cursor)
  if (value > MAX_OFFSET) throw new SelectorOptionsUnavailableError()
  return value
}

function option(id: string, name: string): SafeSelectorOption {
  return { id, label: name || id }
}

async function execute(args: ExecuteServerSelectorArgs, prepared: PreparedDestination) {
  args.signal?.throwIfAborted()
  const context = { client: prepared.client, signal: args.signal }
  try {
    if (args.request.kind === 'detail') {
      const input = narrativeResourceInputSchema.parse({
        ...prepared.auth,
        resourceId: args.request.id,
      })
      if (args.selectorKey === 'oracle_epm_narrative_reporting.artifacts') {
        const { artifact } = (await getLibraryArtifact(input, context)).output
        return detailSelectorResult(option(artifact.artifactId, artifact.name))
      }
      if (args.selectorKey === 'oracle_epm_narrative_reporting.reports') {
        const { report } = (await getReport(input, context)).output
        return detailSelectorResult(option(report.reportId, report.name))
      }
      if (args.selectorKey === 'oracle_epm_narrative_reporting.books') {
        const { book } = (await getBook(input, context)).output
        return detailSelectorResult(option(book.bookId, book.name))
      }
      throw new SelectorOptionsUnavailableError()
    }
    const offset = cursorOffset(args.request.cursor)
    const search = args.request.search?.trim()
    if (search && search.length > 255) throw new SelectorOptionsUnavailableError()
    const input = narrativeListInputSchema.parse({
      ...prepared.auth,
      limit: PAGE_SIZE,
      offset,
      folderId:
        args.selectorKey === 'oracle_epm_narrative_reporting.artifacts'
          ? args.context.folderId
          : undefined,
      q: search ? `name co ${JSON.stringify(search)}` : undefined,
    })
    let items: SafeSelectorOption[]
    let page: { hasMore?: boolean; offset?: number }
    if (args.selectorKey === 'oracle_epm_narrative_reporting.artifacts') {
      const result = (await listLibraryArtifacts(input, context)).output
      items = result.artifacts.map((item) => option(item.artifactId, item.name))
      page = result
    } else if (args.selectorKey === 'oracle_epm_narrative_reporting.reports') {
      const result = (await listReports(input, context)).output
      items = result.reports.map((item) => option(item.reportId, item.name))
      page = result
    } else if (args.selectorKey === 'oracle_epm_narrative_reporting.books') {
      const result = (await listBooks(input, context)).output
      items = result.books.map((item) => option(item.bookId, item.name))
      page = result
    } else {
      throw new SelectorOptionsUnavailableError()
    }
    if (page.offset !== undefined && page.offset !== offset)
      throw new SelectorOptionsUnavailableError()
    if (items.length === 0 && page.hasMore) throw new SelectorOptionsUnavailableError()
    const more = page.hasMore ?? items.length === PAGE_SIZE
    const next = offset + items.length
    const capped = more && next > MAX_OFFSET
    return listSelectorResult(
      items,
      more && !capped ? String(next) : undefined,
      capped ? { truncated: { reason: 'provider-cap', limit: MAX_OFFSET + PAGE_SIZE } } : undefined
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleEpmError) {
      if (args.request.kind === 'detail' && error.category === 'not_found')
        return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status ?? 502)
    }
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle-epm-narrative-reporting'],
} as const
const integrationBlockTypes = ['oracle_epm_narrative_reporting'] as const
export const oracleEpmNarrativeReportingSelectorAttachments = {
  'oracle_epm_narrative_reporting.artifacts': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
  'oracle_epm_narrative_reporting.reports': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
  'oracle_epm_narrative_reporting.books': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare },
    execute,
  }),
} satisfies ServerSelectorAttachmentMap<
  | 'oracle_epm_narrative_reporting.artifacts'
  | 'oracle_epm_narrative_reporting.reports'
  | 'oracle_epm_narrative_reporting.books'
>
