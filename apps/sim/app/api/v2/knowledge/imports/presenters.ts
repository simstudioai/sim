import type {
  V2CreateKnowledgeImportData,
  V2KnowledgeImport,
} from '@/lib/api/contracts/v2/knowledge'
import type {
  CreateKnowledgeImportResult,
  KnowledgeImportResource,
} from '@/lib/knowledge/application/imports'

function toV2KnowledgeImport(resource: KnowledgeImportResource): V2KnowledgeImport {
  return {
    ...resource,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
    completedAt: resource.completedAt?.toISOString() ?? null,
  }
}

export function presentV2KnowledgeImport({
  import: resource,
}: {
  import: KnowledgeImportResource
}) {
  return { data: toV2KnowledgeImport(resource) }
}

export function presentV2CreateKnowledgeImport(result: CreateKnowledgeImportResult): {
  data: V2CreateKnowledgeImportData
} {
  return {
    data: {
      session: toV2KnowledgeImport(result.import),
      uploadToken: result.upload.uploadToken,
      transfer: result.upload.transfer,
    },
  }
}
