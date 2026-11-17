const MAX_UPLOAD_BODY_BYTES = 10 * 1024 * 1024

/** Check encoded CSV content and its request envelope against the proxy's JSON body ceiling. */
export function getGitLabUploadSizeError(body: unknown): string | undefined {
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_UPLOAD_BODY_BYTES)
    return 'The complete upload must be 10 MiB or smaller. Use smaller CSV files or a narrower group.'
}
