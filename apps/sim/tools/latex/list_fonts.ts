import type { LatexFont, LatexListFontsParams, LatexListFontsResponse } from '@/tools/latex/types'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_MAX_RESULTS = 50
const MAX_RESULTS_LIMIT = 200

export const latexListFontsTool: ToolConfig<LatexListFontsParams, LatexListFontsResponse> = {
  id: 'latex_list_fonts',
  name: 'LaTeX List Fonts',
  description:
    'List the system fonts available to the LaTeX compiler, optionally filtered by name, e.g. to pick a font for xelatex or lualatex documents using fontspec.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter matched against font family and full font name, e.g. "Noto Serif"',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of fonts to return (default: 50, max: 200)',
    },
  },

  request: {
    url: 'https://latex.ytotech.com/fonts',
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: LatexListFontsParams) => {
    const data = (await response.json()) as {
      error?: string
      fonts?: Array<{
        family?: string
        name?: string
        styles?: string[]
      }>
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || `LaTeX font listing failed (${response.status})`,
        output: { fonts: [], totalMatches: 0 },
      }
    }

    const query = (params?.query ?? '').trim().toLowerCase()
    const matches = (data.fonts ?? []).filter((font) => {
      if (!query) return true
      return (
        (font.family ?? '').toLowerCase().includes(query) ||
        (font.name ?? '').toLowerCase().includes(query)
      )
    })

    const requested = Math.trunc(Number(params?.maxResults))
    const maxResults =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_RESULTS_LIMIT)
        : DEFAULT_MAX_RESULTS
    const fonts: LatexFont[] = matches.slice(0, maxResults).map((font) => ({
      family: font.family ?? '',
      name: font.name ?? '',
      styles: font.styles ?? [],
    }))

    return {
      success: true,
      output: {
        fonts,
        totalMatches: matches.length,
      },
    }
  },

  outputs: {
    fonts: {
      type: 'array',
      description: 'Fonts available to the LaTeX compiler',
      items: {
        type: 'object',
        properties: {
          family: { type: 'string', description: 'Font family name' },
          name: { type: 'string', description: 'Full font name' },
          styles: { type: 'array', description: 'Available styles, e.g. Bold or Italic' },
        },
      },
    },
    totalMatches: {
      type: 'number',
      description: 'Total number of fonts matching the filter, before truncation',
    },
  },
}
