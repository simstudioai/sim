export interface DesiredWebhookRegistration<TDesired = unknown> {
  triggerId: string
  fingerprint: string
  desired: TDesired
}

export interface ExistingWebhookRegistration<TRow extends { id: string }> {
  triggerId: string
  generation: number
  fingerprint: string | null
  row: TRow
}

export type WebhookRegistrationReconciliationAction<TDesired, TRow extends { id: string }> =
  | {
      kind: 'reuse'
      triggerId: string
      desired: DesiredWebhookRegistration<TDesired>
      existing: ExistingWebhookRegistration<TRow>
    }
  | {
      kind: 'prepare_candidate'
      triggerId: string
      desired: DesiredWebhookRegistration<TDesired>
      existing: ExistingWebhookRegistration<TRow> | null
    }

export interface WebhookRegistrationReconciliationPlan<TDesired, TRow extends { id: string }> {
  actions: Array<WebhookRegistrationReconciliationAction<TDesired, TRow>>
}

function assertGeneration(generation: number, label: string): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

function indexUniqueByTriggerId<T extends { triggerId: string }>(
  entries: readonly T[],
  label: string
): Map<string, T> {
  const entriesByTriggerId = new Map<string, T>()
  for (const entry of entries) {
    if (!entry.triggerId) {
      throw new TypeError(`${label} triggerId cannot be empty`)
    }
    if (entriesByTriggerId.has(entry.triggerId)) {
      throw new TypeError(`${label} contains duplicate triggerId "${entry.triggerId}"`)
    }
    entriesByTriggerId.set(entry.triggerId, entry)
  }
  return entriesByTriggerId
}

/**
 * Produces the side-effect-free registration work for one deployment generation.
 *
 * Fingerprint matches reuse the exact persisted row object, retaining its physical ID and
 * provider-managed state. Changed or missing registrations prepare candidates, while registrations
 * absent from the desired trigger set are retired. A stale generation cannot act on newer rows.
 */
export function planWebhookRegistrationReconciliation<
  TDesired,
  TRow extends { id: string },
>(input: {
  generation: number
  desired: readonly DesiredWebhookRegistration<TDesired>[]
  existing: readonly ExistingWebhookRegistration<TRow>[]
}): WebhookRegistrationReconciliationPlan<TDesired, TRow> {
  assertGeneration(input.generation, 'Reconciliation generation')

  indexUniqueByTriggerId(input.desired, 'Desired registrations')
  const existingByTriggerId = indexUniqueByTriggerId(input.existing, 'Existing registrations')

  for (const existing of input.existing) {
    assertGeneration(
      existing.generation,
      `Existing registration "${existing.triggerId}" generation`
    )
    if (existing.generation > input.generation) {
      throw new Error(
        `Cannot reconcile generation ${input.generation} over newer registration generation ${existing.generation} for trigger "${existing.triggerId}"`
      )
    }
  }

  const actions: Array<WebhookRegistrationReconciliationAction<TDesired, TRow>> = []

  for (const desired of input.desired) {
    const existing = existingByTriggerId.get(desired.triggerId)
    if (existing?.fingerprint === desired.fingerprint) {
      actions.push({
        kind: 'reuse',
        triggerId: desired.triggerId,
        desired,
        existing,
      })
      continue
    }

    actions.push({
      kind: 'prepare_candidate',
      triggerId: desired.triggerId,
      desired,
      existing: existing ?? null,
    })
  }

  return { actions }
}
