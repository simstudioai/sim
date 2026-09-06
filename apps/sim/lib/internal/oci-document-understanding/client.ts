import { createOciClient, type OciAuthenticatedResponse } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { DocumentOperationError } from '@/lib/internal/oci-document-understanding/errors'
import { isDocumentJsonWithinLimit } from '@/tools/oci_document_understanding/shared'

const documentPolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_document_understanding',
  serviceName: 'document.aiservice',
  hostnameTemplate: 'regional-oci',
})
const storagePolicy = createOciStaticEndpointPolicy({
  serviceId: 'oci_document_understanding',
  serviceName: 'objectstorage',
  hostnameTemplate: 'regional',
})

export async function prepareDocumentClient(
  input: { credentialId: string; region?: string },
  workspaceId: string
) {
  if (!workspaceId) throw new DocumentOperationError('Workspace context is required', 403)
  const client = await createOciClient({
    credentialId: input.credentialId,
    region: input.region,
    workspaceId,
    serviceId: 'oci_document_understanding',
  })
  return {
    client,
    endpoint: await client.prepareStaticEndpoint(documentPolicy),
    storage: await client.prepareStaticEndpoint(storagePolicy),
  }
}

export type PreparedDocumentClient = Awaited<ReturnType<typeof prepareDocumentClient>>

export function documentPath(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function documentJsonBody(value: unknown, limit: number) {
  if (!isDocumentJsonWithinLimit(value, limit))
    throw new DocumentOperationError('Document request exceeds its byte limit', 413)
  return new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'))
}

export function parseDocumentJson(response: OciAuthenticatedResponse): unknown {
  try {
    return JSON.parse(Buffer.from(response.body).toString('utf8'))
  } catch {
    throw new DocumentOperationError('Unexpected Document Understanding JSON response', 502)
  }
}
