import {
  CustomToolSkeleton,
  CustomToolsSkeleton,
} from '@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tool-skeleton'

/**
 * Re-export CustomToolSkeleton as SkillSkeleton since both share identical markup.
 */
export const SkillSkeleton = CustomToolSkeleton

/**
 * Skeleton for the Skills section shown during dynamic import loading.
 */
export const SkillsSkeleton = CustomToolsSkeleton
