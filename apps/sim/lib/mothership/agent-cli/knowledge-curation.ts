import {
  v2KnowledgeDocumentSchema,
  v2KnowledgeTaggedDocumentSchema,
} from '@/lib/api/contracts/v2/knowledge'
import { v2CursorListResponse } from '@/lib/api/contracts/v2/shared'
import type { AgentCliRawResult } from '@/lib/mothership/generated/agent-cli'

const documentList = v2CursorListResponse(v2KnowledgeTaggedDocumentSchema)

/** Metadata supplies an address, not proof that the original blob is still available. */
function readDescriptor(doc: {
  id: string
  knowledgeBaseId: string
  processingStatus: string
  enabled: boolean
}) {
  return {
    original: {
      readReference: `knowledge/${doc.knowledgeBaseId}/${doc.id}`,
      availability: 'not_checked',
    },
    indexReady: doc.enabled && doc.processingStatus === 'completed',
  }
}

/** Enriches only validated native document reads, after the normal authorized CLI operation. */
export function curateKnowledgeDocuments(result: AgentCliRawResult): AgentCliRawResult {
  if (result.exitCode !== 0) return result
  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    return result
  }
  const list = documentList.safeParse(value)
  if (list.success)
    return {
      ...result,
      stdout: JSON.stringify({
        ...list.data,
        data: list.data.data.map((doc) => ({ ...doc, ...readDescriptor(doc) })),
      }),
    }
  const doc = v2KnowledgeDocumentSchema.safeParse(value)
  if (!doc.success) return result
  return { ...result, stdout: JSON.stringify({ ...doc.data, ...readDescriptor(doc.data) }) }
}
