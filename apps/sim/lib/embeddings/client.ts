import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { chunkArray } from '@sim/utils/helpers'
import { truncate } from '@sim/utils/string'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env, envNumber } from '@/lib/core/config/env'
import {
  type FallbackFactories,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  wireFallback,
} from '@/lib/core/config/env-capabilities'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  ProviderQuotaExhaustedError,
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getOllamaUrl } from '@/lib/core/utils/urls'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  hasApproximateTokenCount,
  ollamaEmbeddingModelName,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
