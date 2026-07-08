/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  SIM_EVENT_PAYLOAD_FIELDS,
  SIM_EVENT_TYPES,
  SIM_RULE_DEFAULTS,
  SIM_RULE_EVENT_TYPES,
  SIM_TRIGGER_PROVIDER,
  SIM_WORKSPACE_EVENT_TRIGGER_ID,
} from '@/lib/workspace-events/constants'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import { simWorkspaceEventTrigger } from '@/triggers/sim'

describe('sim workspace event trigger registration', () => {
  it('is registered in the trigger registry under its trigger ID', () => {
    expect(TRIGGER_REGISTRY[SIM_WORKSPACE_EVENT_TRIGGER_ID]).toBe(simWorkspaceEventTrigger)
  })

  it('uses the sim provider and is purely internal (no webhook, no polling)', () => {
    expect(simWorkspaceEventTrigger.provider).toBe(SIM_TRIGGER_PROVIDER)
    expect(simWorkspaceEventTrigger.webhook).toBeUndefined()
    expect(simWorkspaceEventTrigger.polling).toBeUndefined()
  })

  it('block type equals the trigger ID so deploy-time trigger resolution works', () => {
    expect(SimWorkspaceEventBlock.type).toBe(SIM_WORKSPACE_EVENT_TRIGGER_ID)
    expect(SimWorkspaceEventBlock.category).toBe('triggers')
    expect(SimWorkspaceEventBlock.triggers).toEqual({
      enabled: true,
      available: [SIM_WORKSPACE_EVENT_TRIGGER_ID],
    })
  })

  it('is named Sim Workspace Events', () => {
    expect(SimWorkspaceEventBlock.name).toBe('Sim Workspace Events')
    expect(simWorkspaceEventTrigger.name).toBe('Sim Workspace Events')
  })
})

describe('sim workspace event subblocks', () => {
  it('all subblocks are trigger-mode with unique IDs', () => {
    const ids = simWorkspaceEventTrigger.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const subBlock of simWorkspaceEventTrigger.subBlocks) {
      expect(subBlock.mode, `subblock ${subBlock.id} must be trigger-mode`).toBe('trigger')
    }
  })

  it('the eventType dropdown covers every event type exactly once', () => {
    const eventTypeSubBlock = simWorkspaceEventTrigger.subBlocks.find(
      (subBlock) => subBlock.id === 'eventType'
    )
    expect(eventTypeSubBlock).toBeDefined()
    const optionIds = (eventTypeSubBlock!.options as Array<{ id: string; label: string }>).map(
      (option) => option.id
    )
    expect(optionIds.sort()).toEqual([...SIM_EVENT_TYPES].sort())
  })

  it('the workflow multi-select is always visible and optional (empty = all workflows)', () => {
    const workflowIds = simWorkspaceEventTrigger.subBlocks.find((sb) => sb.id === 'workflowIds')
    expect(workflowIds).toBeDefined()
    expect(workflowIds!.condition).toBeUndefined()
    expect(workflowIds!.required).toBe(false)
    expect(workflowIds!.multiSelect).toBe(true)
    expect(workflowIds!.placeholder).toBe('All workflows')
  })

  it('has no source-trigger filter or finalOutput toggle', () => {
    const ids = simWorkspaceEventTrigger.subBlocks.map((sb) => sb.id)
    expect(ids).not.toContain('triggerFilter')
    expect(ids).not.toContain('includeFinalOutput')
    expect(ids).not.toContain('allWorkflows')
  })

  it('every rule event type has a config subblock gated to it with the ported default', () => {
    const expectations: Array<{ id: string; eventType: string; defaultValue: string }> = [
      {
        id: 'consecutiveFailures',
        eventType: 'consecutive_failures',
        defaultValue: String(SIM_RULE_DEFAULTS.consecutiveFailures),
      },
      {
        id: 'failureRatePercent',
        eventType: 'failure_rate',
        defaultValue: String(SIM_RULE_DEFAULTS.failureRatePercent),
      },
      {
        id: 'durationThresholdMs',
        eventType: 'latency_threshold',
        defaultValue: String(SIM_RULE_DEFAULTS.durationThresholdMs),
      },
      {
        id: 'latencySpikePercent',
        eventType: 'latency_spike',
        defaultValue: String(SIM_RULE_DEFAULTS.latencySpikePercent),
      },
      {
        id: 'costThresholdCredits',
        eventType: 'cost_threshold',
        defaultValue: String(SIM_RULE_DEFAULTS.costThresholdCredits),
      },
      {
        id: 'errorCountThreshold',
        eventType: 'error_count',
        defaultValue: String(SIM_RULE_DEFAULTS.errorCountThreshold),
      },
      {
        id: 'inactivityHours',
        eventType: 'no_activity',
        defaultValue: String(SIM_RULE_DEFAULTS.inactivityHours),
      },
    ]

    for (const expectation of expectations) {
      const subBlock = simWorkspaceEventTrigger.subBlocks.find((sb) => sb.id === expectation.id)
      expect(subBlock, `missing config subblock ${expectation.id}`).toBeDefined()
      expect(subBlock!.defaultValue).toBe(expectation.defaultValue)
      const condition = subBlock!.condition as { field: string; value: string }
      expect(condition.field).toBe('eventType')
      expect(condition.value).toBe(expectation.eventType)
    }

    const windowHours = simWorkspaceEventTrigger.subBlocks.find((sb) => sb.id === 'windowHours')
    expect(windowHours).toBeDefined()
    const windowCondition = windowHours!.condition as { field: string; value: string[] }
    expect(windowCondition.field).toBe('eventType')
    expect(windowCondition.value.sort()).toEqual(
      ['error_count', 'failure_rate', 'latency_spike'].sort()
    )
  })

  it('rule config subblocks are gated only to rule event types', () => {
    const ruleConfigIds = [
      'consecutiveFailures',
      'failureRatePercent',
      'durationThresholdMs',
      'latencySpikePercent',
      'costThresholdCredits',
      'errorCountThreshold',
      'inactivityHours',
      'windowHours',
    ]
    for (const id of ruleConfigIds) {
      const subBlock = simWorkspaceEventTrigger.subBlocks.find((sb) => sb.id === id)
      const condition = subBlock!.condition as { field: string; value: string | string[] }
      const gatedTo = Array.isArray(condition.value) ? condition.value : [condition.value]
      for (const eventType of gatedTo) {
        expect(
          (SIM_RULE_EVENT_TYPES as readonly string[]).includes(eventType),
          `${id} is gated to non-rule event type ${eventType}`
        ).toBe(true)
      }
    }
  })
})

describe('sim workspace event outputs', () => {
  const EXECUTION_BACKED = [
    'execution_success',
    'execution_error',
    'consecutive_failures',
    'failure_rate',
    'latency_threshold',
    'latency_spike',
    'cost_threshold',
    'error_count',
  ]

  /** Output keys expected in the tag dropdown for a given event type. */
  function visibleOutputsFor(eventType: string): string[] {
    return Object.entries(simWorkspaceEventTrigger.outputs)
      .filter(([, definition]) => {
        const condition = (definition as { condition?: { field: string; value: unknown } })
          .condition
        if (!condition) return true
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        return values.includes(eventType)
      })
      .map(([key]) => key)
      .sort()
  }

  it('trigger outputs align key-for-key with the shared payload field constants', () => {
    const outputKeys = Object.keys(simWorkspaceEventTrigger.outputs).sort()
    const payloadKeys = Object.keys(SIM_EVENT_PAYLOAD_FIELDS).sort()
    expect(outputKeys).toEqual(payloadKeys)
  })

  it('output conditions only reference the eventType field with valid event types', () => {
    for (const [key, definition] of Object.entries(simWorkspaceEventTrigger.outputs)) {
      const condition = (definition as { condition?: { field: string; value: unknown } }).condition
      if (!condition) continue
      expect(condition.field, `${key} condition must gate on eventType`).toBe('eventType')
      const values = Array.isArray(condition.value) ? condition.value : [condition.value]
      for (const value of values) {
        expect(
          (SIM_EVENT_TYPES as readonly string[]).includes(value as string),
          `${key} condition references unknown event type ${value}`
        ).toBe(true)
      }
    }
  })

  it('plain run events expose the base fields plus the top-level run summary', () => {
    for (const eventType of ['execution_success', 'execution_error']) {
      expect(visibleOutputsFor(eventType)).toEqual(
        [
          'cost',
          'durationMs',
          'event',
          'finalOutput',
          'runId',
          'timestamp',
          'workflowId',
          'workflowName',
        ].sort()
      )
    }
  })

  it('run-backed rule events expose the base fields plus the nested triggeringRun', () => {
    for (const eventType of EXECUTION_BACKED.filter(
      (type) => type !== 'execution_success' && type !== 'execution_error'
    )) {
      expect(visibleOutputsFor(eventType)).toEqual(
        ['event', 'timestamp', 'triggeringRun', 'workflowId', 'workflowName'].sort()
      )
    }
  })

  it('triggeringRun nests the same run summary fields as plain run events', () => {
    const triggeringRun = simWorkspaceEventTrigger.outputs.triggeringRun as {
      properties?: Record<string, unknown>
    }
    expect(Object.keys(triggeringRun.properties ?? {}).sort()).toEqual(
      ['cost', 'durationMs', 'finalOutput', 'runId'].sort()
    )
  })

  it('workflow_deployed exposes the base fields plus the version', () => {
    expect(visibleOutputsFor('workflow_deployed')).toEqual(
      ['event', 'timestamp', 'version', 'workflowId', 'workflowName'].sort()
    )
  })

  it('workflow_undeployed exposes only the base fields', () => {
    expect(visibleOutputsFor('workflow_undeployed')).toEqual(
      ['event', 'timestamp', 'workflowId', 'workflowName'].sort()
    )
  })

  it('no_activity exposes only the base fields', () => {
    expect(visibleOutputsFor('no_activity')).toEqual(
      ['event', 'timestamp', 'workflowId', 'workflowName'].sort()
    )
  })
})
