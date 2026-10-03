import type { Artifact, Message, Part, Task } from '@a2a-js/sdk'
import { Role, TaskState } from '@a2a-js/sdk'
import { inputValidationMock } from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { buildUserMessage, taskErrored, taskOutput } from '@/lib/a2a/client'

function textPart(value: string): Part {
  return { content: { $case: 'text', value }, metadata: undefined, filename: '', mediaType: '' }
}

function message(role: Role, parts: Part[]): Message {
  return {
    messageId: 'm-1',
    contextId: 'ctx-1',
    taskId: 'task-1',
    role,
    parts,
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
}

function artifact(name: string, description: string, parts: Part[]): Artifact {
  return {
    artifactId: 'a-1',
    name,
    description,
    parts,
    metadata: undefined,
    extensions: [],
  } as unknown as Artifact
}

function task(opts: {
  state?: TaskState
  statusMessage?: Message
  hasStatus?: boolean
  history?: Message[]
  artifacts?: Artifact[]
}): Task {
  const hasStatus = opts.hasStatus ?? (opts.state !== undefined || opts.statusMessage !== undefined)
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    status: hasStatus
      ? {
          state: opts.state ?? TaskState.TASK_STATE_UNSPECIFIED,
          message: opts.statusMessage,
          timestamp: undefined,
        }
      : undefined,
    artifacts: opts.artifacts ?? [],
    history: opts.history ?? [],
    metadata: undefined,
  }
}

describe('buildUserMessage', () => {
  it('builds a raw file part from resolved bytes', () => {
    const bytes = new TextEncoder().encode('hello')
    const m = buildUserMessage({
      text: 'hi',
      files: [{ bytes, name: 'f.txt', mediaType: 'text/plain' }],
    })
    const content = m.parts[1].content
    expect(content?.$case).toBe('raw')
    if (content?.$case === 'raw') expect(Buffer.from(content.value).toString()).toBe('hello')
    expect(m.parts[1].filename).toBe('f.txt')
    expect(m.parts[1].mediaType).toBe('text/plain')
  })
})

describe('taskErrored', () => {
  it.each([
    [TaskState.TASK_STATE_FAILED, true],
    [TaskState.TASK_STATE_REJECTED, true],
    [TaskState.TASK_STATE_COMPLETED, false],
    [TaskState.TASK_STATE_INPUT_REQUIRED, false],
    [TaskState.TASK_STATE_AUTH_REQUIRED, false],
    [TaskState.TASK_STATE_CANCELED, false],
    [TaskState.TASK_STATE_WORKING, false],
  ])('state %s -> errored %s', (state, expected) => {
    expect(taskErrored(task({ state }))).toBe(expected)
  })
})

describe('taskOutput', () => {
  it('uses the latest agent message from history for content', () => {
    const out = taskOutput(
      task({
        state: TaskState.TASK_STATE_COMPLETED,
        history: [
          message(Role.ROLE_USER, [textPart('q')]),
          message(Role.ROLE_AGENT, [textPart('first')]),
          message(Role.ROLE_AGENT, [textPart('latest')]),
        ],
      })
    )
    expect(out.content).toBe('latest')
  })

  it('maps artifacts to flattened output', () => {
    const out = taskOutput(
      task({
        state: TaskState.TASK_STATE_COMPLETED,
        artifacts: [artifact('report', 'the report', [textPart('body')])],
      })
    )
    expect(out.artifacts).toEqual([{ name: 'report', description: 'the report', content: 'body' }])
  })
})
