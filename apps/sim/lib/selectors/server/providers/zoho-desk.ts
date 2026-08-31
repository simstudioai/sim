import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
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
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { definePreparedSelectorAttachment } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { assertZohoUrl, extractZohoDeskBaseFromScope } from '@/tools/zoho_desk/host-allowlist'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

type ZohoDeskSelectorKey = Extract<
  ServerSelectorKey,
  'zoho_desk.organizations' | 'zoho_desk.departments' | 'zoho_desk.agents'
>

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['zoho-desk'],
} as const

async function readOAuthApiDomain(credentialId: string): Promise<string | undefined> {
  try {
    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved?.accountId) return undefined
    const [row] = await db
      .select({ scope: account.scope })
      .from(account)
      .where(eq(account.id, resolved.accountId))
      .limit(1)
    return extractZohoDeskBaseFromScope(row?.scope)
  } catch {
    return undefined
  }
}

interface ZohoDeskDestination {
  accessToken: string
  apiBase: string
}

async function prepareZohoDestination(
  args: ExecuteServerSelectorArgs
): Promise<ZohoDeskDestination> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  const apiDomain = bundle.apiDomain ?? (await readOAuthApiDomain(args.credential.suppliedId))
  args.protectedValues.add(apiDomain, 'reference')
  const apiBase = getZohoDeskApiBase({ apiDomain })
  return { accessToken: bundle.accessToken, apiBase }
}

async function fetchZoho(
  args: ExecuteServerSelectorArgs,
  url: URL,
  headers: Record<string, string>
): Promise<{ status: number; data: unknown[] }> {
  let response
  try {
    response = await secureFetchWithValidation(url.toString(), {
      method: 'GET',
      headers,
      timeout: 15_000,
      maxResponseBytes: 2 * 1024 * 1024,
      stripAuthOnRedirect: true,
      signal: args.signal,
      logUrlValidationDetails: false,
    })
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }
  if (response.status === 204) return { status: 204, data: [] }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw selectorProviderStatusError(response.status)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new SelectorOptionsUnavailableError()
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    throw new SelectorOptionsUnavailableError()
  }
  return { status: response.status, data: (body as { data: unknown[] }).data }
}

async function listOrganizations(
  args: ExecuteServerSelectorArgs,
  destination: ZohoDeskDestination
): Promise<SafeSelectorOption[]> {
  const { accessToken, apiBase } = destination
  let url: URL
  try {
    url = assertZohoUrl(`${apiBase}/organizations`)
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  const { data } = await fetchZoho(args, url, {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
  })
  return data.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const organization = value as {
      id?: string | number
      companyName?: string
      portalName?: string
    }
    if (organization.id === undefined || organization.id === null) return []
    const id = String(organization.id)
    return [{ id, label: organization.companyName || organization.portalName || id }]
  })
}

async function listOrgResources(
  args: ExecuteServerSelectorArgs,
  kind: 'departments' | 'agents',
  destination: ZohoDeskDestination
) {
  const orgId = args.context.orgId
  if (!orgId) throw new SelectorContextUnavailableError()
  const { accessToken, apiBase } = destination
  const headers = buildZohoDeskHeaders({ accessToken, orgId })
  const items: SafeSelectorOption[] = []
  const seen = new Set<string>()
  let truncated = false

  for (let page = 0; page < 20; page++) {
    let url: URL
    try {
      url = assertZohoUrl(`${apiBase}/${kind}`)
    } catch {
      throw new SelectorConnectionUnavailableError()
    }
    url.searchParams.set('from', String(page * 200))
    url.searchParams.set('limit', '200')
    if (kind === 'agents') url.searchParams.set('status', 'ACTIVE')
    const result = await fetchZoho(args, url, headers)
    if (result.status === 204) break

    for (const value of result.data) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      if (record.id === undefined || record.id === null) continue
      const id = String(record.id)
      if (seen.has(id)) continue
      seen.add(id)
      let label: string
      if (kind === 'departments') {
        label =
          (typeof record.name === 'string' && record.name) ||
          (typeof record.nameInCustomerPortal === 'string' && record.nameInCustomerPortal) ||
          id
      } else {
        const name = typeof record.name === 'string' ? record.name.trim() : ''
        const fullName = [record.firstName, record.lastName]
          .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
          .map((part) => part.trim())
          .join(' ')
        label =
          name || fullName || (typeof record.emailId === 'string' && record.emailId.trim()) || id
      }
      items.push({ id, label })
    }
    if (result.data.length < 200) break
    if (page === 19) truncated = true
  }
  return { items, truncated }
}

export const zohoDeskSelectorAttachments = {
  'zoho_desk.organizations': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareZohoDestination },
    execute: async (args, destination) =>
      flatSelectorResult(args.request, await listOrganizations(args, destination)),
  }),
  'zoho_desk.departments': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareZohoDestination },
    execute: async (args, destination) => {
      const result = await listOrgResources(args, 'departments', destination)
      return flatSelectorResult(
        args.request,
        result.items,
        false,
        result.truncated ? { truncated: { reason: 'provider-cap', pages: 20 } } : undefined
      )
    },
  }),
  'zoho_desk.agents': definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareZohoDestination },
    execute: async (args, destination) => {
      const result = await listOrgResources(args, 'agents', destination)
      return flatSelectorResult(
        args.request,
        result.items,
        false,
        result.truncated ? { truncated: { reason: 'provider-cap', pages: 20 } } : undefined
      )
    },
  }),
} satisfies ServerSelectorAttachmentMap<ZohoDeskSelectorKey>
