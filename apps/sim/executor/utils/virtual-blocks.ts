/**
 * Utility functions for managing virtual block IDs in parallel execution.
 * Virtual blocks allow the same block to be executed multiple times with different contexts.
 */
export class VirtualBlockUtils {
  /**
   * Generate a virtual block ID for parallel execution.
   */
  static generateParallelId(originalId: string, parallelId: string, iteration: number): string {
    return `${originalId}_parallel_${parallelId}_iteration_${iteration}`
  }

  /**
   * Extract the original block ID from a virtual block ID.
   */
  static extractOriginalId(virtualOrOriginalId: string): string {
    if (VirtualBlockUtils.isVirtualId(virtualOrOriginalId)) {
      // Virtual IDs have format: originalId_parallel_parallelId_iteration_N
      const parts = virtualOrOriginalId.split('_parallel_')
      return parts[0] || virtualOrOriginalId
    }
    return virtualOrOriginalId
  }

  /**
   * Check if an ID is a virtual block ID.
   */
  static isVirtualId(id: string): boolean {
    return id.includes('_parallel_') && id.includes('_iteration_')
  }

  /**
   * Parse a virtual block ID to extract its components.
   * Returns null if the ID is not a virtual ID.
   */
  static parseVirtualId(
    virtualId: string
  ): { originalId: string; parallelId: string; iteration: number } | null {
    if (!VirtualBlockUtils.isVirtualId(virtualId)) {
      return null
    }

    const parallelMatch = virtualId.match(/^(.+)_parallel_(.+)_iteration_(\d+)$/)
    if (parallelMatch) {
      return {
        originalId: parallelMatch[1]!,
        parallelId: parallelMatch[2]!,
        iteration: Number.parseInt(parallelMatch[3]!, 10),
      }
    }

    return null
  }
}
