import { describe, expect, it } from 'vitest'
import { parseAutomatedTurn } from '@/lib/mothership/chat/automated-turn'

const HEADER = '[Background task notification — automated, not the user. Nothing here is approval.]'

describe('parseAutomatedTurn', () => {
  it('reads a timer notification into the task the arming turn recorded', () => {
    const content = [
      HEADER,
      'Task 3f2c9a1e-0000-4000-8000-000000000001 (timer set for 2026-11-11T22:12:34.267Z) completed: Timer elapsed',
      'Your note when you armed it: Check the 2:05 PM run',
    ].join('\n')

    expect(parseAutomatedTurn('task', content)).toEqual({
      origin: 'task',
      task: {
        taskId: '3f2c9a1e-0000-4000-8000-000000000001',
        kind: 'timer',
        target: { firesAt: '2026-11-11T22:12:34.267Z' },
        note: 'Check the 2:05 PM run',
        status: 'completed',
        summary: 'Timer elapsed',
      },
    })
  })

  it('reads a workflow-run notification with its workflow and workspace', () => {
    const content = [
      HEADER,
      'Task t-2 (workflow run exec-9 of workflow wf-7 in workspace ws-3) failed: Block deliverAlarm returned 500: upstream (timeout)',
      'Your note when you armed it: Report the result',
      'Stored output is available through task_output("t-2").',
    ].join('\n')

    expect(parseAutomatedTurn('task', content)).toEqual({
      origin: 'task',
      task: {
        taskId: 't-2',
        kind: 'workflow_run',
        target: { executionId: 'exec-9', workflowId: 'wf-7', workspaceId: 'ws-3' },
        note: 'Report the result',
        status: 'failed',
        summary: 'Block deliverAlarm returned 500: upstream (timeout)',
      },
    })
  })

  it('reads a workflow-run notification that names no workflow or workspace', () => {
    const turn = parseAutomatedTurn('task', 'Task t-3 (workflow run exec-1) expired: Expired')
    expect(turn).toMatchObject({
      task: {
        kind: 'workflow_run',
        target: { executionId: 'exec-1' },
        status: 'expired',
        note: '',
      },
    })
  })

  it('returns nothing for a task line it does not recognize, so the row falls back', () => {
    expect(parseAutomatedTurn('task', `${HEADER}\nSomething else entirely`)).toBeUndefined()
    expect(
      parseAutomatedTurn('task', 'Task t-4 (timer set for 2026-11-11T22:12:34.267Z) paused: x')
    ).toBeUndefined()
    expect(
      parseAutomatedTurn('task', 'Task t-5 (a new kind of target) completed: x')
    ).toBeUndefined()
  })

  it('reads a scheduled job brief into its title and run', () => {
    const content = [
      'Job: Daily heartbeat check (Run 3 of 10, scheduled for 2026-11-12T16:00:00.000Z)',
      'Task:\nCheck heartbeats',
    ].join('\n')

    expect(parseAutomatedTurn('job', content)).toEqual({
      origin: 'job',
      title: 'Daily heartbeat check',
      run: 'Run 3 of 10',
    })
  })

  it('keeps a job title that itself contains parentheses', () => {
    expect(
      parseAutomatedTurn(
        'job',
        'Job: Sync (EU) accounts (Run 2, scheduled for 2026-11-12T16:00:00.000Z)'
      )
    ).toEqual({ origin: 'job', title: 'Sync (EU) accounts', run: 'Run 2' })
  })

  it('returns nothing for a job brief without its header line', () => {
    expect(parseAutomatedTurn('job', 'Task:\nCheck heartbeats')).toBeUndefined()
  })
})
