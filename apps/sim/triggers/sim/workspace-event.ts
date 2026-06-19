import { SimTriggerIcon } from '@/components/icons'
import { fetchWorkspaceWorkflowOptions } from '@/lib/workflows/subblocks/options'
import {
  SIM_EVENT_PAYLOAD_FIELDS,
  SIM_RULE_DEFAULTS,
  SIM_TRIGGER_PROVIDER,
  SIM_WORKSPACE_EVENT_TRIGGER_ID,
} from '@/lib/workspace-events/constants'
import type { TriggerConfig } from '@/triggers/types'

export const simWorkspaceEventTrigger: TriggerConfig = {
  id: SIM_WORKSPACE_EVENT_TRIGGER_ID,
  name: 'Sim Workspace Events',
  provider: SIM_TRIGGER_PROVIDER,
  description:
    'Triggers when workspace events occur: run errors or successes, deployments, and alert conditions like latency or cost spikes',
  version: '1.0.0',
  icon: SimTriggerIcon,

  subBlocks: [
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: [
        { id: 'execution_error', label: 'Run Error', group: 'Events' },
        { id: 'execution_success', label: 'Run Success', group: 'Events' },
        { id: 'workflow_deployed', label: 'Workflow Deployed', group: 'Events' },
        { id: 'workflow_undeployed', label: 'Workflow Undeployed', group: 'Events' },
        { id: 'consecutive_failures', label: 'Consecutive Failures', group: 'Alert Conditions' },
        { id: 'failure_rate', label: 'Failure Rate', group: 'Alert Conditions' },
        { id: 'latency_threshold', label: 'Latency Threshold', group: 'Alert Conditions' },
        { id: 'latency_spike', label: 'Latency Spike', group: 'Alert Conditions' },
        { id: 'cost_threshold', label: 'Cost Threshold', group: 'Alert Conditions' },
        { id: 'error_count', label: 'Error Count', group: 'Alert Conditions' },
        { id: 'no_activity', label: 'No Activity', group: 'Alert Conditions' },
      ],
      defaultValue: 'execution_error',
      description: 'The workspace event or alert condition to trigger on.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'workflowIds',
      title: 'Workflows',
      type: 'dropdown',
      multiSelect: true,
      options: [],
      placeholder: 'All workflows',
      description: 'Only fire for these workflows. Leave empty to watch every workflow.',
      required: false,
      mode: 'trigger',
      // A subscriber never receives events about itself, so exclude it.
      fetchOptions: () => fetchWorkspaceWorkflowOptions({ excludeActiveWorkflow: true }),
    },
    {
      id: 'consecutiveFailures',
      title: 'Consecutive Failures',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.consecutiveFailures),
      defaultValue: String(SIM_RULE_DEFAULTS.consecutiveFailures),
      description: 'Fire after this many consecutive failed runs.',
      required: { field: 'eventType', value: 'consecutive_failures' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'consecutive_failures' },
    },
    {
      id: 'failureRatePercent',
      title: 'Failure Rate (%)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.failureRatePercent),
      defaultValue: String(SIM_RULE_DEFAULTS.failureRatePercent),
      description:
        'Fire when the failure rate meets or exceeds this percentage over the time window.',
      required: { field: 'eventType', value: 'failure_rate' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'failure_rate' },
    },
    {
      id: 'durationThresholdMs',
      title: 'Duration Threshold (ms)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.durationThresholdMs),
      defaultValue: String(SIM_RULE_DEFAULTS.durationThresholdMs),
      description: 'Fire when a run takes longer than this many milliseconds.',
      required: { field: 'eventType', value: 'latency_threshold' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'latency_threshold' },
    },
    {
      id: 'latencySpikePercent',
      title: 'Latency Spike (%)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.latencySpikePercent),
      defaultValue: String(SIM_RULE_DEFAULTS.latencySpikePercent),
      description: 'Fire when a run is this much slower than the average over the time window.',
      required: { field: 'eventType', value: 'latency_spike' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'latency_spike' },
    },
    {
      id: 'costThresholdCredits',
      title: 'Cost Threshold (credits)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.costThresholdCredits),
      defaultValue: String(SIM_RULE_DEFAULTS.costThresholdCredits),
      description: 'Fire when a run costs more than this many credits.',
      required: { field: 'eventType', value: 'cost_threshold' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'cost_threshold' },
    },
    {
      id: 'errorCountThreshold',
      title: 'Error Count',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.errorCountThreshold),
      defaultValue: String(SIM_RULE_DEFAULTS.errorCountThreshold),
      description: 'Fire when at least this many errors occur within the time window.',
      required: { field: 'eventType', value: 'error_count' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'error_count' },
    },
    {
      id: 'windowHours',
      title: 'Time Window (hours)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.windowHours),
      defaultValue: String(SIM_RULE_DEFAULTS.windowHours),
      description: 'The rolling time window used to evaluate this condition.',
      required: {
        field: 'eventType',
        value: ['failure_rate', 'latency_spike', 'error_count'],
      },
      mode: 'trigger',
      condition: {
        field: 'eventType',
        value: ['failure_rate', 'latency_spike', 'error_count'],
      },
    },
    {
      id: 'inactivityHours',
      title: 'Inactivity Window (hours)',
      type: 'short-input',
      placeholder: String(SIM_RULE_DEFAULTS.inactivityHours),
      defaultValue: String(SIM_RULE_DEFAULTS.inactivityHours),
      description: 'Fire when a watched workflow has no runs for this many hours.',
      required: { field: 'eventType', value: 'no_activity' },
      mode: 'trigger',
      condition: { field: 'eventType', value: 'no_activity' },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Choose the workspace event or alert condition to react to',
        'Optionally narrow it to specific workflows — leaving the selection empty watches every workflow (this workflow is always excluded; it never triggers itself)',
        'Deploy this workflow — events only fire for deployed workflows',
        'Runs started by this trigger never emit workspace events, so chains and loops are not possible',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: SIM_EVENT_PAYLOAD_FIELDS,
}
