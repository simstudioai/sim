/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { buildScheduleCorrelation } from './schedule-execution'
import { buildWebhookCorrelation } from './webhook-execution'
import { buildWorkflowCorrelation } from './workflow-execution'

describe('async execution correlation fallbacks', () => {
  it('falls back for legacy workflow payloads missing correlation fields', () => {
    const correlation = buildWorkflowCorrelation({
      workflowId: 'workflow-1',
      userId: 'user-1',
      triggerType: 'api',
      executionId: 'execution-legacy',
    })

    expect(correlation).toEqual({
      executionId: 'execution-legacy',
      requestId: 'executio',
      source: 'workflow',
      workflowId: 'workflow-1',
      triggerType: 'api',
    })
  })

  it('falls back for legacy schedule payloads missing preassigned request id', () => {
    const correlation = buildScheduleCorrelation({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      executionId: 'schedule-exec-1',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })

    expect(correlation).toEqual({
      executionId: 'schedule-exec-1',
      requestId: 'schedule',
      source: 'schedule',
      workflowId: 'workflow-1',
      scheduleId: 'schedule-1',
      triggerType: 'schedule',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })
  })

  it('falls back for legacy webhook payloads missing preassigned fields', () => {
    const correlation = buildWebhookCorrelation({
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      executionId: 'webhook-exec-1',
      provider: 'slack',
      body: {},
      headers: {},
      path: 'incoming/slack',
    })

    expect(correlation).toEqual({
      executionId: 'webhook-exec-1',
      requestId: 'webhook-',
      source: 'webhook',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      path: 'incoming/slack',
      provider: 'slack',
      triggerType: 'webhook',
    })
  })
})
