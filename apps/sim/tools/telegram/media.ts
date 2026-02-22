function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeTelegramMediaParam(
  input: unknown,
  opts: {
    label: string
    errorMessage?: string
    multipleErrorMessage?: string
  }
): string {
  const missingMessage = opts.errorMessage ?? `${opts.label} URL or file_id is required.`
  const multipleMessage =
    opts.multipleErrorMessage ??
    `${opts.label} reference must be a single item, not an array. Select one item (e.g. <block.files[0]>).`

  if (input === null || input === undefined) {
    throw new Error(missingMessage)
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      throw new Error(missingMessage)
    }

    // Support advanced-mode values that were JSON.stringify'd into short-input fields.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed) as unknown
      } catch {
        parsed = undefined
      }

      if (parsed !== undefined) {
        return normalizeTelegramMediaParam(parsed, opts)
      }
    }

    return trimmed
  }

  if (input instanceof URL) {
    const asString = input.toString().trim()
    if (asString.length > 0) return asString
    throw new Error(missingMessage)
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error(missingMessage)
    }
    if (input.length > 1) {
      throw new Error(multipleMessage)
    }
    return normalizeTelegramMediaParam(input[0], opts)
  }

  if (isRecord(input)) {
    if ('url' in input && typeof input.url === 'string') {
      const url = input.url.trim()
      if (url.length > 0) return url
    }

    if ('href' in input && typeof input.href === 'string') {
      const href = input.href.trim()
      if (href.length > 0) return href
    }

    if ('file_id' in input && typeof input.file_id === 'string') {
      const fileId = input.file_id.trim()
      if (fileId.length > 0) return fileId
    }

    if ('fileId' in input && typeof input.fileId === 'string') {
      const fileId = input.fileId.trim()
      if (fileId.length > 0) return fileId
    }
  }

  throw new Error(missingMessage)
}
