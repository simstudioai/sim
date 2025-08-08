import '@/executor/__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it } from 'vitest'
import { TriggerBlockHandler } from '@/executor/handlers/trigger/trigger-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

describe('TriggerBlockHandler', () => {
  let handler: TriggerBlockHandler
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new TriggerBlockHandler()

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
    }
  })

  describe('canHandle', () => {
    it.concurrent('should handle blocks with triggers category', () => {
      const triggerBlock: SerializedBlock = {
        id: 'trigger-1',
        metadata: { id: 'schedule', name: 'Schedule Block', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'schedule', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      expect(handler.canHandle(triggerBlock)).toBe(true)
    })

    it.concurrent('should handle blocks with triggerMode enabled', () => {
      const gmailTriggerBlock: SerializedBlock = {
        id: 'gmail-1',
        metadata: { id: 'gmail', name: 'Gmail Block', category: 'tools' },
        position: { x: 0, y: 0 },
        config: { tool: 'gmail', params: { triggerMode: true } },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      expect(handler.canHandle(gmailTriggerBlock)).toBe(true)
    })

    it.concurrent('should not handle regular tool blocks without triggerMode', () => {
      const toolBlock: SerializedBlock = {
        id: 'tool-1',
        metadata: { id: 'gmail', name: 'Gmail Block', category: 'tools' },
        position: { x: 0, y: 0 },
        config: { tool: 'gmail', params: { triggerMode: false } },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      expect(handler.canHandle(toolBlock)).toBe(false)
    })

    it.concurrent('should not handle blocks without trigger indicators', () => {
      const regularBlock: SerializedBlock = {
        id: 'regular-1',
        metadata: { id: 'api', name: 'API Block', category: 'tools' },
        position: { x: 0, y: 0 },
        config: { tool: 'api', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      expect(handler.canHandle(regularBlock)).toBe(false)
    })

    it.concurrent('should handle generic webhook blocks', () => {
      const webhookBlock: SerializedBlock = {
        id: 'webhook-1',
        metadata: { id: 'generic_webhook', name: 'Generic Webhook', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'generic_webhook', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      expect(handler.canHandle(webhookBlock)).toBe(true)
    })
  })

  describe('execute', () => {
    it.concurrent('should return inputs directly when provided', async () => {
      const triggerBlock: SerializedBlock = {
        id: 'trigger-1',
        metadata: { id: 'gmail', name: 'Gmail Trigger', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'gmail', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const triggerInputs = {
        email: {
          id: '12345',
          subject: 'Test Email',
          from: 'test@example.com',
          body: 'Hello world',
        },
        timestamp: '2023-01-01T12:00:00Z',
      }

      const result = await handler.execute(triggerBlock, triggerInputs, mockContext)

      expect(result).toEqual(triggerInputs)
    })

    it.concurrent('should return empty object when no inputs provided', async () => {
      const triggerBlock: SerializedBlock = {
        id: 'trigger-1',
        metadata: { id: 'schedule', name: 'Schedule Trigger', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'schedule', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const result = await handler.execute(triggerBlock, {}, mockContext)

      expect(result).toEqual({})
    })

    it.concurrent('should handle webhook payload inputs', async () => {
      const webhookBlock: SerializedBlock = {
        id: 'webhook-1',
        metadata: { id: 'generic_webhook', name: 'Generic Webhook', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'generic_webhook', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const webhookInputs = {
        payload: {
          event: 'user.created',
          data: {
            user: {
              id: 'user123',
              email: 'user@example.com',
            },
          },
        },
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }

      const result = await handler.execute(webhookBlock, webhookInputs, mockContext)

      expect(result).toEqual(webhookInputs)
    })

    it.concurrent('should handle Outlook trigger inputs', async () => {
      const outlookBlock: SerializedBlock = {
        id: 'outlook-1',
        metadata: { id: 'outlook', name: 'Outlook Block', category: 'tools' },
        position: { x: 0, y: 0 },
        config: { tool: 'outlook', params: { triggerMode: true } },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const outlookInputs = {
        email: {
          id: 'outlook123',
          subject: 'Meeting Invitation',
          from: 'colleague@company.com',
          bodyPreview: 'Join us for the quarterly review...',
        },
        timestamp: '2023-01-01T14:30:00Z',
      }

      const result = await handler.execute(outlookBlock, outlookInputs, mockContext)

      expect(result).toEqual(outlookInputs)
    })

    it.concurrent('should handle schedule trigger with no inputs', async () => {
      const scheduleBlock: SerializedBlock = {
        id: 'schedule-1',
        metadata: { id: 'schedule', name: 'Daily Schedule', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'schedule', params: { scheduleType: 'daily' } },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const result = await handler.execute(scheduleBlock, {}, mockContext)

      // Schedule triggers typically don't have input data, just trigger the workflow
      expect(result).toEqual({})
    })

    it.concurrent('should handle complex nested trigger data', async () => {
      const triggerBlock: SerializedBlock = {
        id: 'complex-trigger-1',
        metadata: { id: 'webhook', name: 'Complex Webhook', category: 'triggers' },
        position: { x: 0, y: 0 },
        config: { tool: 'webhook', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }

      const complexInputs = {
        webhook: {
          data: {
            provider: 'github',
            payload: {
              action: 'opened',
              pull_request: {
                id: 123,
                title: 'Fix bug in authentication',
                user: { login: 'developer' },
                base: { ref: 'main' },
                head: { ref: 'fix-auth-bug' },
              },
            },
            headers: { 'x-github-event': 'pull_request' },
          },
        },
        timestamp: '2023-01-01T15:45:00Z',
      }

      const result = await handler.execute(triggerBlock, complexInputs, mockContext)

      expect(result).toEqual(complexInputs)
    })
  })

  describe('integration scenarios', () => {
    it.concurrent('should work with different trigger block types', () => {
      const testCases = [
        {
          name: 'Gmail in trigger mode',
          block: {
            id: 'gmail-trigger',
            metadata: { id: 'gmail', category: 'tools' },
            config: { tool: 'gmail', params: { triggerMode: true } },
          },
          shouldHandle: true,
        },
        {
          name: 'Generic webhook',
          block: {
            id: 'webhook-trigger',
            metadata: { id: 'generic_webhook', category: 'triggers' },
            config: { tool: 'generic_webhook', params: {} },
          },
          shouldHandle: true,
        },
        {
          name: 'Schedule block',
          block: {
            id: 'schedule-trigger',
            metadata: { id: 'schedule', category: 'triggers' },
            config: { tool: 'schedule', params: {} },
          },
          shouldHandle: true,
        },
        {
          name: 'Regular API block',
          block: {
            id: 'api-block',
            metadata: { id: 'api', category: 'tools' },
            config: { tool: 'api', params: {} },
          },
          shouldHandle: false,
        },
        {
          name: 'Gmail in tool mode',
          block: {
            id: 'gmail-tool',
            metadata: { id: 'gmail', category: 'tools' },
            config: { tool: 'gmail', params: { triggerMode: false } },
          },
          shouldHandle: false,
        },
      ]

      testCases.forEach(({ name, block, shouldHandle }) => {
        const serializedBlock: SerializedBlock = {
          ...block,
          position: { x: 0, y: 0 },
          inputs: {},
          outputs: {},
          enabled: true,
        } as SerializedBlock

        expect(
          handler.canHandle(serializedBlock),
          `${name} should ${shouldHandle ? '' : 'not '}be handled`
        ).toBe(shouldHandle)
      })
    })
  })
})
