export interface CustomToolDraftSource {
  id: string
  schema: string
  code: string
}

export function customToolSourceChanged(
  previous: CustomToolDraftSource,
  next: CustomToolDraftSource
): boolean {
  return previous.id !== next.id || previous.schema !== next.schema || previous.code !== next.code
}
