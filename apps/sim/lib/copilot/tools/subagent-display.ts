import { humanizeToolName } from '@/lib/copilot/tools/tool-display'

/** Canonical user-facing labels for Mothership subagent lanes. */
export const SUBAGENT_LABELS: Readonly<Record<string, string>> = {
  workflow: 'Workflow Agent',
  debug: 'Debug Agent',
  deploy: 'Deploy Agent',
  auth: 'Auth Agent',
  research: 'Research Agent',
  knowledge: 'Knowledge Agent',
  table: 'Table Agent',
  custom_tool: 'Custom Tool Agent',
  scout: 'Scout Agent',
  search: 'Search Agent',
  superagent: 'Superagent',
  run: 'Run Agent',
  agent: 'Tools Agent',
  scheduled_task: 'Scheduled Task Agent',
  /** Backward-compatible label for historical transcripts. */
  job: 'Job Agent',
  file: 'File Agent',
  media: 'Media Agent',
  browser: 'Browser Agent',
} as const

/** Resolves a server-owned subagent id without exposing raw identifier casing. */
export function getSubagentDisplayTitle(agentId: string): string {
  return SUBAGENT_LABELS[agentId] ?? humanizeToolName(agentId || 'subagent')
}
