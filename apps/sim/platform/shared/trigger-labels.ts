/** The core triggers' labels, one set for Logs, a run's details and a secret's usage trail. */
export const CORE_TRIGGER_LABELS = {
  manual: 'Manual',
  api: 'API',
  schedule: 'Schedule',
  chat: 'Chat',
  webhook: 'Webhook',
  mcp: 'MCP',
  copilot: 'Sim agent',
  mothership: 'Sim agent',
  workflow: 'Workflow',
  custom_block: 'Custom block',
  test: 'Test',
} as const

/** A core trigger's label, or `undefined` for an integration trigger, which reads as its block. */
export function coreTriggerLabel(trigger: string): string | undefined {
  return Object.hasOwn(CORE_TRIGGER_LABELS, trigger)
    ? CORE_TRIGGER_LABELS[trigger as keyof typeof CORE_TRIGGER_LABELS]
    : undefined
}

/** A trigger's label: a core trigger's own, or an integration trigger's id in words, each capitalized. */
export function triggerLabel(trigger: string): string {
  return (
    coreTriggerLabel(trigger) ??
    trigger
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}
