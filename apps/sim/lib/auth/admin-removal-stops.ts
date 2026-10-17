import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  collectAccountRemovalStops,
  type ExecutionStopPlan,
  enqueueExecutionStops,
  signalExecutionStops,
} from '@/lib/execution/removal-stop-records'

const logger = createLogger('AdminRemovalStops')

/**
 * Plans read by {@link holdAdminRemovalStops} and acted on by {@link stopAdminRemovedRuns},
 * keyed by the user entity Better Auth passes to both hooks of one delete. A delete that fails
 * never reaches `after`, so its plan is dropped with the entity.
 */
const pendingStops = new WeakMap<object, ExecutionStopPlan>()

/**
 * The user delete's `before` hook: `/admin/remove-user` deletes the user row outside any
 * transaction, and the cascade erases the rows naming its runs, so they are read now. A failed
 * read lets the removal proceed as before rather than blocking an admin.
 */
export async function holdAdminRemovalStops(user: { id: string }): Promise<void> {
  try {
    pendingStops.set(user, await collectAccountRemovalStops(db, user.id))
  } catch (error) {
    logger.error('Failed to read the runs a user removal must stop', {
      userId: user.id,
      error: getErrorMessage(error),
    })
  }
}

/**
 * The user delete's `after` hook, once the delete has committed: signals the in-flight runs at
 * once, whether or not their stops could be recorded, and records the stops for the outbox
 * worker's queue sweep and retries. Never throws.
 */
export async function stopAdminRemovedRuns(user: { id: string }): Promise<void> {
  const plan = pendingStops.get(user)
  pendingStops.delete(user)
  if (!plan) return
  try {
    await enqueueExecutionStops(db, plan)
  } catch (error) {
    logger.error('Failed to record the stops of a removed user’s runs', {
      userId: user.id,
      error: getErrorMessage(error),
    })
  } finally {
    await signalExecutionStops(plan.executions)
  }
}
