import type { OutputProperty } from '@/tools/types'

/**
 * Map a raw Grafana ProvisionedAlertRule JSON object to the canonical output shape
 * shared across list/get/create/update alert rule tools.
 */
export function mapAlertRule(rule: Record<string, unknown>) {
  return {
    id: (rule.id as number) ?? null,
    uid: (rule.uid as string) ?? null,
    title: (rule.title as string) ?? null,
    condition: (rule.condition as string) ?? null,
    data: (rule.data as unknown[]) ?? [],
    updated: (rule.updated as string) ?? null,
    noDataState: (rule.noDataState as string) ?? null,
    execErrState: (rule.execErrState as string) ?? null,
    for: (rule.for as string) ?? null,
    keepFiringFor: (rule.keepFiringFor as string) ?? (rule.keep_firing_for as string) ?? null,
    missingSeriesEvalsToResolve:
      (rule.missing_series_evals_to_resolve as number) ??
      (rule.missingSeriesEvalsToResolve as number) ??
      null,
    annotations: (rule.annotations as Record<string, string>) ?? {},
    labels: (rule.labels as Record<string, string>) ?? {},
    isPaused: (rule.isPaused as boolean) ?? false,
    folderUID: (rule.folderUID as string) ?? null,
    ruleGroup: (rule.ruleGroup as string) ?? null,
    orgID: (rule.orgID as number) ?? (rule.orgId as number) ?? null,
    provenance: (rule.provenance as string) ?? '',
    notification_settings: (rule.notification_settings as Record<string, unknown>) ?? null,
    record: (rule.record as Record<string, unknown>) ?? null,
  }
}

/**
 * Canonical output schema fields shared across alert rule tools.
 */
export const alertRuleOutputFields: Record<string, OutputProperty> = {
  id: { type: 'number', description: 'Alert rule numeric ID', optional: true },
  uid: { type: 'string', description: 'Alert rule UID' },
  title: { type: 'string', description: 'Alert rule title' },
  condition: { type: 'string', description: 'RefId of the query used as the alert condition' },
  data: { type: 'json', description: 'Alert rule query/expression data array' },
  updated: { type: 'string', description: 'Last update timestamp', optional: true },
  noDataState: { type: 'string', description: 'State when no data is returned' },
  execErrState: { type: 'string', description: 'State on execution error' },
  for: { type: 'string', description: 'Duration the condition must hold before firing' },
  keepFiringFor: {
    type: 'string',
    description: 'Duration to keep firing after condition stops',
    optional: true,
  },
  missingSeriesEvalsToResolve: {
    type: 'number',
    description: 'Number of missing series evaluations before resolving',
    optional: true,
  },
  annotations: { type: 'json', description: 'Alert annotations' },
  labels: { type: 'json', description: 'Alert labels' },
  isPaused: { type: 'boolean', description: 'Whether the rule is paused' },
  folderUID: { type: 'string', description: 'Parent folder UID' },
  ruleGroup: { type: 'string', description: 'Rule group name' },
  orgID: { type: 'number', description: 'Organization ID' },
  provenance: { type: 'string', description: 'Provisioning source (empty if API-managed)' },
  notification_settings: {
    type: 'json',
    description: 'Per-rule notification settings (overrides)',
    optional: true,
  },
  record: {
    type: 'json',
    description: 'Recording rule configuration (recording rules only)',
    optional: true,
  },
}
