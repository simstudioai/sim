import { filterUndefined } from '@sim/utils/object'
import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeCreateFileInput,
  type NarrativeCreateFolderInput,
  type NarrativeListInput,
  type NarrativeResourceInput,
  narrativeArtifactSchema,
  narrativePageSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const FIELDS =
  'artifactId,name,description,type,typeID,pathName,createdBy,creationDate,modifiedBy,modifiedDate,lastAccessed,favorite,ordinal'

export async function listLibraryArtifacts(
  input: NarrativeListInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(
    input.folderId ? narrativeEndpoints.listArtifactChildren : narrativeEndpoints.listArtifacts,
    {
      ...(input.folderId ? { pathParams: { id: input.folderId } } : {}),
      query: {
        fields: FIELDS,
        limit: input.limit,
        offset: input.offset,
        q: input.q,
        orderBy: input.orderBy,
      },
      signal: context.signal,
    }
  )
  const { items, ...page } = parseNarrativeJson(
    narrativePageSchema(narrativeArtifactSchema),
    response
  )
  return { success: true, output: { artifacts: items, ...page } }
}

export async function getLibraryArtifact(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getArtifact, {
    pathParams: { id: input.resourceId },
    query: { fields: FIELDS },
    signal: context.signal,
  })
  return {
    success: true,
    output: { artifact: parseNarrativeJson(narrativeArtifactSchema, response) },
  }
}

export async function createLibraryFolder(
  input: NarrativeCreateFolderInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.createArtifact, {
    json: filterUndefined({
      name: input.name,
      description: input.description,
      systemPath: input.systemPath,
      type: 'FolderResourceType',
    }),
    signal: context.signal,
  })
  return {
    success: true,
    output: { artifact: parseNarrativeJson(narrativeArtifactSchema, response, 201) },
  }
}

export async function createLibraryFile(
  input: NarrativeCreateFileInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.createArtifact, {
    query: { overwrite: input.overwrite },
    json: filterUndefined({
      name: input.name,
      description: input.description,
      systemPath: input.systemPath,
      type: 'FileResourceType',
      mimeType: input.mimeType,
      file: input.providerFile,
    }),
    signal: context.signal,
  })
  return {
    success: true,
    output: { artifact: parseNarrativeJson(narrativeArtifactSchema, response, 201) },
  }
}

export async function deleteLibraryArtifact(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.deleteArtifact, {
    pathParams: { id: input.resourceId },
    signal: context.signal,
  })
  if (response.status !== 204) throw oracleEpmLocalError('invalid_response')
  return { success: true, output: { deleted: true, artifactId: input.resourceId } }
}
