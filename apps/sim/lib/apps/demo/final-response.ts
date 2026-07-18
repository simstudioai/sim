import type { DemoProgressEvent } from '@/lib/apps/demo/types'

export function buildFullstackNarrationPrompt(params: {
  originalPrompt: string
  finalEvent: DemoProgressEvent
}): string {
  const summary = {
    outcome: params.finalEvent.phase,
    workflowCount: params.finalEvent.workflowCount ?? 0,
    actionIds: params.finalEvent.actionIds ?? [],
    frontendSource: params.finalEvent.frontendSource,
    error: params.finalEvent.error,
    code: params.finalEvent.code,
  }
  return [
    'You are the final narrator for a Sim Full-stack App build.',
    'Return one concise user-facing response in plain Markdown.',
    'Do not mention internal agents, JSON, prompts, credentials, revision IDs, build IDs, or implementation details.',
    'If the preview is ready, say what is ready and suggest 2-3 useful follow-ups only after the completion summary.',
    'If the build failed, explain the user-safe error and one concrete retry step. Do not claim success.',
    '',
    `Original request:\n${params.originalPrompt}`,
    '',
    `Sanitized outcome:\n${JSON.stringify(summary, null, 2)}`,
  ].join('\n')
}

export function fallbackFullstackFinalResponse(event: DemoProgressEvent): string {
  if (event.phase === 'preview_ready') {
    const workflowLabel =
      typeof event.workflowCount === 'number'
        ? `${event.workflowCount} backend workflow${event.workflowCount === 1 ? '' : 's'}`
        : 'the backend workflows'
    return [
      `Your app is ready. I connected ${workflowLabel}, generated the interface, and opened the live preview.`,
      '',
      'Suggested follow-ups:',
      '- Refine the layout, colors, or copy',
      '- Add another backend action',
      '- Test the current preview, then deploy',
    ].join('\n')
  }
  if (event.phase === 'credential_selection_required') {
    return 'Choose the connected account to use below, then I’ll continue building the interface.'
  }
  if (event.code === 'CANCELLED') return 'Stopped the Full-stack build.'
  return (
    event.error || event.message || 'The Full-stack build could not be completed. Please retry.'
  )
}
