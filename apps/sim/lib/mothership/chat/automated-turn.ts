import type { TurnOrigin } from '@/lib/mothership/generated/protocol'
import type { TaskBlockInfo } from '@/lib/mothership/request/types'

/**
 * What a turn that automation opened was about: the background task whose notification woke
 * the chat, or the scheduled job whose run it is. Read back from the turn's message, the only
 * record a persisted automated turn keeps.
 */
export type AutomatedTurn =
  | { origin: 'task'; task: TaskBlockInfo }
  | { origin: 'job'; title: string; run: string }

/** Mothership's `notificationText`: `Task <id> (<target>) <status>: <summary>`. */
const TASK_LINE = /^Task (\S+) \((.+?)\) (completed|failed|stopped|expired): (.*)$/
const TIMER_TARGET = /^timer set for (\S+)$/
const WORKFLOW_TARGET = /^workflow run (\S+)(?: of workflow (\S+))?(?: in workspace (\S+))?$/
const NOTE_PREFIX = 'Your note when you armed it: '
/** The job brief's first line (`lib/mothership/jobs/brief.ts`). */
const JOB_LINE = /^Job: (.+) \((Run \d+(?: of \d+)?), scheduled for [^)]+\)$/

function parseTarget(target: string): Pick<TaskBlockInfo, 'kind' | 'target'> | undefined {
  const timer = TIMER_TARGET.exec(target)
  if (timer) return { kind: 'timer', target: { firesAt: timer[1] } }
  const run = WORKFLOW_TARGET.exec(target)
  if (!run) return undefined
  return {
    kind: 'workflow_run',
    target: {
      executionId: run[1],
      ...(run[2] ? { workflowId: run[2] } : {}),
      ...(run[3] ? { workspaceId: run[3] } : {}),
    },
  }
}

/** Returns undefined when the message is not in a shape this version knows, so the row falls back. */
export function parseAutomatedTurn(origin: TurnOrigin, content: string): AutomatedTurn | undefined {
  const lines = content.split('\n')
  if (origin === 'job') {
    const job = JOB_LINE.exec(lines[0] ?? '')
    return job ? { origin, title: job[1], run: job[2] } : undefined
  }
  const match = lines.map((line) => TASK_LINE.exec(line)).find((found) => found !== null)
  if (!match) return undefined
  const target = parseTarget(match[2])
  if (!target) return undefined
  const note = lines.find((line) => line.startsWith(NOTE_PREFIX))?.slice(NOTE_PREFIX.length) ?? ''
  return {
    origin,
    task: {
      taskId: match[1],
      ...target,
      note,
      status: match[3] as NonNullable<TaskBlockInfo['status']>,
      summary: match[4],
    },
  }
}
