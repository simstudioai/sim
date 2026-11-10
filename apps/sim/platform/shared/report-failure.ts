import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'

/** Shows a failed row action as a toast: the row has no dialog of its own to hold the error. */
export async function reportFailure(work: Promise<unknown>, message: string): Promise<void> {
  try {
    await work
  } catch (error) {
    toast.error(message, { description: getErrorMessage(error, 'Please try again in a moment.') })
  }
}
