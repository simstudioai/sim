import { toast } from '@sim/emcn'

/** An item the batch reached but could not act on, with a reason worth showing. */
interface BulkFailure {
  name: string
  reason: string
}

/** An id that resolved to nothing active — deleted, or not visible to this user. */
interface BulkMissing {
  id: string
}

export interface BulkOutcome {
  failed: BulkFailure[]
  notFound: BulkMissing[]
}

/**
 * Reports the parts of a bulk operation that did not happen.
 *
 * A bulk request succeeds as a whole while individual items are refused (a delete lock, a
 * folder cycle) or have vanished since the list was rendered. Those items are the difference
 * between what the user selected and what actually changed, so they have to be said out loud —
 * the list simply refetching leaves the user to notice a row survived.
 *
 * Success stays silent, matching the single-item move and delete paths.
 *
 * @param verb Past-tense verb for the failure sentence, e.g. `'moved'` or `'deleted'`.
 */
export function reportBulkOutcome(outcome: BulkOutcome, verb: string): void {
  const { failed, notFound } = outcome

  if (failed.length > 0) {
    const [first] = failed
    toast.error(
      failed.length === 1
        ? `${first.name} could not be ${verb}: ${first.reason}`
        : `${failed.length} items could not be ${verb}. ${first.name}: ${first.reason}`,
      { duration: 5000 }
    )
    return
  }

  if (notFound.length > 0) {
    toast.error(
      notFound.length === 1
        ? `One item was no longer available and was not ${verb}.`
        : `${notFound.length} items were no longer available and were not ${verb}.`,
      { duration: 5000 }
    )
  }
}
