import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export class WorkflowImportError extends OrchestrationError {
  constructor(
    code: OrchestrationErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(code, message)
    this.name = 'WorkflowImportError'
  }
}
