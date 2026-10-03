import type { OutputProperty } from '@/tools/types'

export async function transformZoomInfoResponse(
  response: Response
): Promise<{ status: number; data: unknown }> {
  const data = (await response.json()) as
    | { success: true; output: { status: number; data: unknown } }
    | { success: false; error?: string; status?: number }
  if (!('success' in data) || data.success === false) {
    const errMessage = 'error' in data && data.error ? data.error : 'ZoomInfo request failed'
    throw new Error(errMessage)
  }
  return { status: data.output.status, data: data.output.data }
}

export const paginationOutputProperties: Record<string, OutputProperty> = {
  totalResults: {
    type: 'number',
    description: 'Total number of matching results across all pages',
    optional: true,
  },
  currentPage: {
    type: 'number',
    description: 'Current page number',
    optional: true,
  },
  totalPages: {
    type: 'number',
    description: 'Total number of pages available',
    optional: true,
  },
}

export function extractPagination(payload: unknown): {
  totalResults: number | null
  currentPage: number | null
  totalPages: number | null
} {
  if (payload && typeof payload === 'object') {
    const meta = (payload as Record<string, unknown>).meta as
      | { totalResults?: unknown; page?: { number?: unknown; total?: unknown } }
      | undefined
    if (meta) {
      const totalResults = typeof meta.totalResults === 'number' ? meta.totalResults : null
      const currentPage =
        meta.page && typeof meta.page.number === 'number' ? meta.page.number : null
      const totalPages = meta.page && typeof meta.page.total === 'number' ? meta.page.total : null
      return { totalResults, currentPage, totalPages }
    }
  }
  return { totalResults: null, currentPage: null, totalPages: null }
}

export function extractDataArray(payload: unknown): Array<Record<string, unknown>> {
  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data
    if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  }
  return []
}
