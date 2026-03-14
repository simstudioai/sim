import {
  ApiKeySkeleton,
  ApiKeysSkeleton,
} from '@/app/workspace/[workspaceId]/settings/components/api-keys/api-key-skeleton'

/**
 * Re-export ApiKeySkeleton as CopilotKeySkeleton since both share identical markup.
 */
export const CopilotKeySkeleton = ApiKeySkeleton

/**
 * Skeleton for the Copilot section shown during dynamic import loading.
 */
export const CopilotSkeleton = ApiKeysSkeleton
