/** Shared resource contract for the Function base and every custom child image. */
export const FUNCTION_SANDBOX_CPU_COUNT = 2
export const FUNCTION_SANDBOX_MEMORY_GB = 4
export const FUNCTION_SANDBOX_MEMORY_MB = FUNCTION_SANDBOX_MEMORY_GB * 1024
export const FUNCTION_DAYTONA_DISK_GB = 10

/**
 * boxd machine sizes pair 2 vCPU with 8 GiB, the smallest size that keeps the
 * Function CPU count. Disk is priced like Daytona's, at the image's working set.
 */
export const FUNCTION_BOXD_MEMORY_GB = 8
export const FUNCTION_BOXD_DISK_GB = 10

/** Bump when custom dependency-layer rendering changes without a semantic spec change. */
export const FUNCTION_SANDBOX_MATERIALIZER_REVISION = 2
