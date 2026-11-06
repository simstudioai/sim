import { OrchestrationError } from '@/lib/core/orchestration/types'

/** A Project lifecycle rule or lock refused the change; callers may map it to their own error. */
export class ProjectConflictError extends OrchestrationError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'ProjectConflictError'
  }
}

/** The file's content revision moved during an optimistic read-then-write; a fresh read may succeed. */
export class ProjectFileRevisionConflictError extends OrchestrationError {
  constructor(message: string) {
    super('conflict', message)
    this.name = 'ProjectFileRevisionConflictError'
  }
}
