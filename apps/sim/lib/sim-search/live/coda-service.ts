import type { CodaMcpClient } from '@/lib/sim-search/live/coda-mcp'
import { NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import type { NativeClient, NativeDocument } from '@/lib/sim-search/live/types'
import { codaAdminDocSchema, codaDocSchema, codaIdSchema } from '@/connectors/coda/client'
import { codaOrganizationPath, codaSourceConfig } from '@/connectors/coda/config'

type Reference = Pick<NativeDocument, 'id' | 'container' | 'kind'>
const MAX_DOCUMENT_CHECKS = 100

async function documentId(reference: Reference, mcp?: CodaMcpClient): Promise<string | null> {
  let id = reference.id
  if (id.startsWith('https://') && mcp) {
    let url: URL
    try {
      url = new URL(id)
    } catch {
      return null
    }
    if (
      !['https://coda.io', 'https://docs.superhuman.com'].includes(url.origin) ||
      url.username ||
      url.password
    )
      return null
    const decoded = object(
      await mcp.call('url_convert', { action: 'decode', url: id, scope: 'document' })
    )
    id = string(decoded.docUri ?? decoded.uri)
  }
  if (mcp || reference.kind === 'mcp') {
    if (id.length > 1000 || !/^coda:\/\/docs\/[\w-]+(?:\/[\w-]+)*$/.test(id)) return null
    id = id.slice('coda://docs/'.length).split('/')[0]!
  }
  return codaIdSchema.safeParse(id).success ? id : null
}

/** Checks the service account's document boundary; the member's MCP/REST grant enforces their access. */
export function createCodaServiceVerifier(
  client: NativeClient,
  config: Record<string, unknown>,
  mcp?: CodaMcpClient
): (document: Reference) => Promise<boolean> {
  const { docIds, organizationId } = codaSourceConfig(config, { mirrorsSourceAcls: true })
  const selected = new Set(docIds)
  const checked = new Map<string, Promise<boolean>>()
  const verify = async (id: string): Promise<boolean> => {
    if (organizationId) {
      const result = object(
        await client.json(`/apis/admin/v1${codaOrganizationPath(organizationId, 'docs')}`, {
          query: { docIds: id, limit: '1', fetchPermissionsMode: 'none' },
        })
      )
      if (!Array.isArray(result.items) || result.items.length !== 1 || result.nextPageToken)
        return false
      const parsed = codaAdminDocSchema.safeParse(result.items[0])
      return (
        parsed.success &&
        parsed.data.id === id &&
        !parsed.data.isDeleted &&
        !parsed.data.keyAccessRevoked
      )
    }
    const parsed = codaDocSchema.safeParse(await client.json(`/apis/v1/docs/${segment(id)}`))
    return (
      parsed.success &&
      parsed.data.id === id &&
      !parsed.data.isDeleted &&
      !parsed.data.keyAccessRevoked
    )
  }
  return async (document) => {
    const id = await documentId(document, mcp)
    if (!id || (selected.size && !selected.has(id))) return false
    let pending = checked.get(id)
    if (!pending) {
      if (checked.size >= MAX_DOCUMENT_CHECKS)
        throw new NativeSearchError('unavailable', 'Coda document check limit reached.')
      pending = verify(id)
      checked.set(id, pending)
    }
    return pending
  }
}
