import { createLogger } from '@sim/logger'

const logger = createLogger('FileRetention')

/** A budgeted run fails whole; otherwise one owner's failure is logged so it cannot starve the rest. */
export async function isolateOwnerFailure(
  budgeted: boolean,
  owner: Record<string, string>,
  cleanup: () => Promise<number>
): Promise<number> {
  try {
    return await cleanup()
  } catch (error) {
    if (budgeted) throw error
    logger.error('File retention failed for one owner', { ...owner, error })
    return 0
  }
}
