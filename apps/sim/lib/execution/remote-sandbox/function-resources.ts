/** Shared resource contract for the Function base and every custom child image. */
export const FUNCTION_SANDBOX_CPU_COUNT = 2
export const FUNCTION_SANDBOX_MEMORY_GB = 4
export const FUNCTION_SANDBOX_MEMORY_MB = FUNCTION_SANDBOX_MEMORY_GB * 1024
export const FUNCTION_DAYTONA_DISK_GB = 10

/** Bump when custom dependency-layer rendering changes without a semantic spec change. */
export const FUNCTION_SANDBOX_MATERIALIZER_REVISION = 2
