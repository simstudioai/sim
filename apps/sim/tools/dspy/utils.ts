import type { DSPyTrajectoryStep } from '@/tools/dspy/types'

/**
 * Parse DSPy ReAct trajectory format into structured steps
 * DSPy trajectory format: { thought_0, tool_name_0, tool_args_0, observation_0, thought_1, ... }
 */
export function parseTrajectory(trajectory: Record<string, unknown>): DSPyTrajectoryStep[] {
  const steps: DSPyTrajectoryStep[] = []
  let idx = 0

  while (
    trajectory[`thought_${idx}`] !== undefined ||
    trajectory[`tool_name_${idx}`] !== undefined
  ) {
    steps.push({
      thought: (trajectory[`thought_${idx}`] as string) ?? '',
      toolName: (trajectory[`tool_name_${idx}`] as string) ?? '',
      toolArgs: (trajectory[`tool_args_${idx}`] as Record<string, unknown>) ?? {},
      observation:
        trajectory[`observation_${idx}`] !== undefined
          ? String(trajectory[`observation_${idx}`])
          : null,
    })
    idx++
  }

  return steps
}

/**
 * The DSPy server URL for an endpoint path (default `/predict`). A path typed without its
 * leading slash still lands on that path instead of being appended to the host name.
 */
export function buildDSPyUrl(baseUrl: string, endpoint?: string): string {
  const path = endpoint?.trim() || '/predict'
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
