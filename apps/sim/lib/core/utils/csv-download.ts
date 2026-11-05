/** The header a CSV export route sets when it stopped at its row cap. */
const TRUNCATED_HEADER = 'X-Export-Truncated'

interface CsvDownloadResult {
  ok: boolean
  /** The file holds only part of what the request matched. */
  truncated: boolean
}

/**
 * Fetches a CSV export, then saves it under `filename`. A failed response saves nothing and reports
 * `ok: false`, so each surface words its own failure. A rejected fetch rejects, as a fetch does.
 */
export async function downloadCsvExport(url: string, filename: string): Promise<CsvDownloadResult> {
  // boundary-raw-fetch: downloads a CSV blob and reads a response header before saving — a plain anchor navigation can't do either
  const response = await fetch(url)
  if (!response.ok) return { ok: false, truncated: false }
  const truncated = response.headers.get(TRUNCATED_HEADER) === '1'
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Deferred: revoking synchronously after click() can race the download starting.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  return { ok: true, truncated }
}
