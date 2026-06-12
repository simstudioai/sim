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
    keepFiringFor: (rule.keep_firing_for as string) ?? (rule.keepFiringFor as string) ?? null,
    missingSeriesEvalsToResolve:
      (rule.missingSeriesEvalsToResolve as number) ??
      (rule.missing_series_evals_to_resolve as number) ??
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
