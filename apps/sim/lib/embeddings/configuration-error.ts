import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Safe deployment capability failure, separate from absent results or caller permissions. */
export class EmbeddingConfigurationError extends OrchestrationError {
  readonly capability = 'semantic_retrieval'
  readonly reason = 'provider_not_configured'
  readonly retryable = false
  readonly recovery =
    'Configure an embedding provider, or read authorized original documents directly.'

  constructor() {
    super(
      'conflict',
      'Semantic retrieval is unavailable because its embedding provider is not configured.'
    )
    this.name = 'EmbeddingConfigurationError'
  }
}
