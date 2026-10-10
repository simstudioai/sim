import { OrchestrationError } from '@/lib/core/orchestration/types'

/** A Project lifecycle rule or lock refused the change; callers may map it to their own error. */
export class ProjectConflictError extends OrchestrationError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'ProjectConflictError'
  }
}
