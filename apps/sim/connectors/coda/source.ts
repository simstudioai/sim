import {
  type CodaDoc,
  codaAdminDocSchema,
  codaDocSchema,
  codaJson,
  codaListSchema,
} from '@/connectors/coda/client'
import { codaOrganizationPath } from '@/connectors/coda/config'
import { ConnectorSourceError } from '@/connectors/source-error'
import { codaDocPath } from '@/tools/coda/utils'

/** Uses current workspace-qualified Admin endpoints; organization-only doc endpoints are deprecated. */
export function codaDocumentPath(doc: CodaDoc, organizationId?: string): string {
  if (!organizationId) return codaDocPath(doc.id)
  const { workspaceId } = codaAdminDocSchema.parse(doc)
  return codaOrganizationPath(organizationId, 'workspaces', [workspaceId, 'workspaceId'], 'docs', [
    doc.id,
    'docId',
  ])
}

/** Resolves the current workspace from the documented organization document filter. */
export async function readCodaDoc(
  token: string,
  docId: string,
  organizationId?: string,
  validating = false
): Promise<CodaDoc> {
  let doc: CodaDoc
  if (organizationId) {
    const result = await codaJson(
      token,
      codaOrganizationPath(organizationId, 'docs'),
      codaListSchema(codaAdminDocSchema),
      { docIds: docId, limit: 1, fetchPermissionsMode: 'none' },
      validating,
      true
    )
    if (result.nextPageToken || result.items.length > 1)
      throw new Error('Coda returned an ambiguous document lookup')
    const found = result.items[0]
    if (!found)
      throw new ConnectorSourceError('Coda document was not found in the organization', 404)
    doc = found
  } else {
    doc = await codaJson(token, codaDocPath(docId), codaDocSchema, undefined, validating)
  }
  if (doc.id !== docId) throw new Error('Coda returned a different document')
  return doc
}
