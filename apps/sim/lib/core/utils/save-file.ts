/** Saves a blob under `filename`, through the browser's download path. */
export function saveFile(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Deferred: revoking synchronously after click() can race the download starting.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
