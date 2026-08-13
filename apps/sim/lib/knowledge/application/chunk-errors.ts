import { OrchestrationError } from '@/lib/core/orchestration/types'

export class KnowledgeDocumentNotReadyError extends OrchestrationError {
  constructor(readonly processingStatus: string) {
    super('validation', `Document is not ready for access (status: ${processingStatus})`)
    this.name = 'KnowledgeDocumentNotReadyError'
  }
}
