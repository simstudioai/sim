/** Accepts navigable provider links without embedding credentials or rewriting their identity. */
export function isKnowledgeSourceUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}
