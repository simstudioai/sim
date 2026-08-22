/** The link scheme for portable workspace resource mentions. */
export const SIM_LINK_SCHEME = 'sim'

/** Builds the link target for a mention of `kind`/`id`. */
export function toSimHref(kind: string, id: string): string {
  const encodedId = encodeURIComponent(id)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/gi, '/')
  return `${SIM_LINK_SCHEME}:${kind}/${encodedId}`
}

/** Builds portable mention Markdown while escaping characters that can break its label. */
export function toSimMarkdownLink(kind: string, id: string, label: string): string {
  const escapedLabel = label.replace(/[\\[\]]/g, '\\$&')
  return `[${escapedLabel}](${toSimHref(kind, id)})`
}

/** Restores a label serialized by {@link toSimMarkdownLink}. */
export function fromSimMarkdownLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, '$1')
}

/** Restores an identifier serialized into a `sim:` link without throwing on malformed input. */
export function fromSimHrefId(id: string): string {
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}
