import type { WorkflowTestSession } from '@/lib/workflow-tests/session'

/** Live sessions by sandbox request id; each entry is removed when its sandbox run ends. */
const sessions = new Map<string, WorkflowTestSession>()

export function openWorkflowTestSession(requestId: string, session: WorkflowTestSession): void {
  sessions.set(requestId, session)
}

export function closeWorkflowTestSession(requestId: string): void {
  sessions.get(requestId)?.close()
  sessions.delete(requestId)
}

export function requireWorkflowTestSession(requestId: string): WorkflowTestSession {
  const session = sessions.get(requestId)
  if (!session) throw new Error('This workflow test run is no longer active')
  return session
}
