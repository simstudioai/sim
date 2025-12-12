export const getTriggerColor = (trigger: string | null | undefined): string => {
  if (!trigger) return '#9ca3af'
  switch (trigger.toLowerCase()) {
    case 'manual':
      return '#9ca3af'
    case 'schedule':
      return '#10b981'
    case 'webhook':
      return '#f97316'
    case 'chat':
      return '#8b5cf6'
    case 'api':
      return '#3b82f6'
    default:
      return '#9ca3af'
  }
}
