/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCopilotApplicationPrincipal,
  requireInteractiveCopilotExecutionContext,
  requireTrustedCopilotExecutionContext,
} from '@/lib/mothership/auth/application-delegation'

const trustedContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as const

describe('Copilot application delegation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [
      'marker',
      { ...trustedContext, copilotToolExecution: undefined },
      'trusted Copilot execution context',
    ],
    ['user', { ...trustedContext, userId: undefined }, 'authenticated user ID'],
    ['workspace', { ...trustedContext, workspaceId: undefined }, 'workspace ID'],
    ['tool call', { ...trustedContext, toolCallId: undefined }, 'tool call ID'],
  ])('rejects a missing or invalid trusted %s', (_field, context, message) => {
    expect(() => requireTrustedCopilotExecutionContext(context)).toThrow(message)
  })

  it('creates an explicitly bounded Copilot principal from trusted context', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    expect(
      createCopilotApplicationPrincipal(trustedContext, {
        audience: 'sim:files',
        ttlMs: 5 * 60 * 1000,
        createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
        resourceScope: { fileId: 'file-1' },
      })
    ).toEqual({
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
      delegationId: 'copilot-tool:tool-call-1',
      audience: 'sim:files',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-01T00:05:00Z'),
      resourceScope: {
        fileId: 'file-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
      },
    })
  })

  it.each([undefined, 'headless' as const])(
    'rejects non-interactive live platform context (%s)',
    (copilotInteractionMode) => {
      expect(() =>
        requireInteractiveCopilotExecutionContext({
          ...trustedContext,
          copilotInteractionMode,
        })
      ).toThrow('only in an interactive Copilot session')
    }
  )

  it('accepts a server-classified interactive lifecycle', () => {
    expect(
      requireInteractiveCopilotExecutionContext({
        ...trustedContext,
        copilotInteractionMode: 'interactive',
      })
    ).toMatchObject({ copilotInteractionMode: 'interactive' })
  })
})
