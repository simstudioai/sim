import { createLogger } from '@sim/logger'
import { toast } from '@/lib/toast/sink'
import { saveBlob } from '@/lib/uploads/client/download'

const logger = createLogger('PlatformCsvExport')

interface CsvExport {
  /** The export route, with its query. */
  url: string
  filename: string
  /** The toast a failed export shows. */
  failure: string
}

/**
 * Downloads an export route's CSV. Fetches rather than following an anchor so the
 * `X-Export-Truncated` header can be read before saving.
 */
export async function downloadCsvExport({ url, filename, failure }: CsvExport): Promise<void> {
  try {
    // boundary-raw-fetch: downloads a CSV blob and reads X-Export-Truncated before saving, which a plain anchor navigation can do neither of
    const response = await fetch(url)
    if (!response.ok) {
      toast.error(failure)
      return
    }
    if (response.headers.get('X-Export-Truncated') === '1') {
      toast.info('Export truncated: narrow the date range to see everything')
    }
    saveBlob(await response.blob(), filename)
  } catch (error) {
    logger.error('CSV export failed', { filename, error })
    toast.error(failure)
  }
}
