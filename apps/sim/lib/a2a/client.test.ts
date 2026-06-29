/**
 * @vitest-environment node
 */
import type { AgentCard, Artifact, Message, Part, Task } from '@a2a-js/sdk'
import { Role, TaskState } from '@a2a-js/sdk'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
}))

import {
  agentCardOutput,
  buildUserMessage,
  extractText,
  isTaskResult,
  messageOutput,
  taskErrored,
  taskOutput,
} from '@/lib/a2a/client'

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
  it('builds a text-only user message', () => {
    const m = buildUserMessage({ text: 'hello' })
    expect(m.role).toBe(Role.ROLE_USER)
    expect(m.parts).toHaveLength(1)
    expect(m.parts[0].content).toEqual({ $case: 'text', value: 'hello' })
    expect(m.taskId).toBe('')
    expect(m.contextId).toBe('')
  })

  it('passes through taskId and contextId', () => {
    const m = buildUserMessage({ text: 'hi', taskId: 't', contextId: 'c' })
    expect(m.taskId).toBe('t')
    expect(m.contextId).toBe('c')
  })

  it('appends a data part for structured data', () => {
    const data = { foo: 'bar' }
    const m = buildUserMessage({ text: 'hi', data })
    expect(m.parts).toHaveLength(2)
    expect(m.parts[1].content).toEqual({ $case: 'data', value: data })
  })

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

describe('extractText', () => {
  it('joins text parts and ignores non-text parts', () => {
    const m = message(Role.ROLE_AGENT, [
      textPart('a'),
      { content: { $case: 'data', value: {} }, metadata: undefined, filename: '', mediaType: '' },
      textPart('b'),
    ])
    expect(extractText(m)).toBe('a\nb')
  })
})

describe('isTaskResult', () => {
  it('treats objects with a status key as tasks', () => {
    expect(isTaskResult(task({ state: TaskState.TASK_STATE_COMPLETED }))).toBe(true)
  })

  it('treats messages as non-tasks', () => {
    expect(isTaskResult(message(Role.ROLE_AGENT, [textPart('hi')]))).toBe(false)
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

  it('is false when status is missing', () => {
    expect(taskErrored(task({ hasStatus: false }))).toBe(false)
  })
})

describe('taskOutput', () => {
  it('maps state to a friendly label', () => {
    expect(taskOutput(task({ state: TaskState.TASK_STATE_COMPLETED })).state).toBe('completed')
    expect(taskOutput(task({ state: TaskState.TASK_STATE_INPUT_REQUIRED })).state).toBe(
      'input-required'
    )
  })

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

  it('falls back to the status message when history has no agent text', () => {
    const out = taskOutput(
      task({
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        statusMessage: message(Role.ROLE_AGENT, [textPart('need more info')]),
      })
    )
    expect(out.content).toBe('need more info')
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

  it('carries task and context ids', () => {
    const out = taskOutput(task({ state: TaskState.TASK_STATE_COMPLETED }))
    expect(out.taskId).toBe('task-1')
    expect(out.contextId).toBe('ctx-1')
  })
})

describe('messageOutput', () => {
  it('maps a direct message to a completed output', () => {
    const out = messageOutput(message(Role.ROLE_AGENT, [textPart('done')]))
    expect(out).toEqual({
      content: 'done',
      taskId: 'task-1',
      contextId: 'ctx-1',
      state: 'completed',
      artifacts: [],
    })
  })
})

describe('agentCardOutput', () => {
  function makeCard(fields: {
    supportedInterfaces?: Array<{ url: string; protocolVersion: string }>
    skills?: Array<{ id: string; name: string; description: string }>
  }): AgentCard {
    return {
      name: 'Agent',
      description: 'desc',
      version: '1.2.3',
      supportedInterfaces: fields.supportedInterfaces ?? [],
      capabilities: undefined,
      skills: fields.skills ?? [],
      defaultInputModes: [],
      defaultOutputModes: [],
    } as unknown as AgentCard
  }

  it('falls back to the agent url when there are no interfaces', () => {
    const out = agentCardOutput(makeCard({}), 'https://fallback.example/a2a')
    expect(out.url).toBe('https://fallback.example/a2a')
    expect(out.protocolVersion).toBe('')
    expect(out.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    })
  })

  it('prefers the first supported interface', () => {
    const out = agentCardOutput(
      makeCard({
        supportedInterfaces: [{ url: 'https://agent.example/rpc', protocolVersion: '1.0' }],
      }),
      'https://fallback.example/a2a'
    )
    expect(out.url).toBe('https://agent.example/rpc')
    expect(out.protocolVersion).toBe('1.0')
  })

  it('maps skills to id, name, and description', () => {
    const out = agentCardOutput(
      makeCard({ skills: [{ id: 's1', name: 'Search', description: 'searches' }] }),
      'https://fallback.example/a2a'
    )
    expect(out.skills).toEqual([{ id: 's1', name: 'Search', description: 'searches' }])
  })
})
