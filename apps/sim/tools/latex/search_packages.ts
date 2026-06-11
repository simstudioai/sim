import type {
  LatexPackageSummary,
  LatexSearchPackagesParams,
  LatexSearchPackagesResponse,
} from '@/tools/latex/types'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_MAX_RESULTS = 25
const MAX_RESULTS_LIMIT = 100

export const latexSearchPackagesTool: ToolConfig<
  LatexSearchPackagesParams,
  LatexSearchPackagesResponse
> = {
  id: 'latex_search_packages',
  name: 'LaTeX Search Packages',
  description:
    'Search the TeX Live packages available to the LaTeX compiler by name or description, e.g. to check which packages can be used in a document.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search terms matched against package names and descriptions',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of packages to return (default: 25, max: 100)',
    },
  },

  request: {
    url: 'https://latex.ytotech.com/packages',
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: LatexSearchPackagesParams) => {
    const data = (await response.json()) as {
      error?: string
      packages?: Array<{
        name?: string
        shortdesc?: string
        installed?: boolean
        url_ctan?: string
      }>
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || `LaTeX package search failed (${response.status})`,
        output: { packages: [], totalMatches: 0 },
      }
    }

    const query = (params?.query ?? '').trim().toLowerCase()
    if (!query) {
      return {
        success: false,
        error: 'Search query cannot be empty',
        output: { packages: [], totalMatches: 0 },
      }
    }

    const matches = (data.packages ?? []).filter(
      (pkg) =>
        (pkg.name ?? '').toLowerCase().includes(query) ||
        (pkg.shortdesc ?? '').toLowerCase().includes(query)
    )

    const requested = Math.trunc(Number(params?.maxResults))
    const maxResults =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_RESULTS_LIMIT)
        : DEFAULT_MAX_RESULTS
    const packages: LatexPackageSummary[] = matches.slice(0, maxResults).map((pkg) => ({
      name: pkg.name ?? '',
      shortDescription: pkg.shortdesc ?? null,
      installed: pkg.installed ?? false,
      ctanUrl: pkg.url_ctan ?? null,
    }))

    return {
      success: true,
      output: {
        packages,
        totalMatches: matches.length,
      },
    }
  },

  outputs: {
    packages: {
      type: 'array',
      description: 'TeX Live packages matching the query',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Package name' },
          shortDescription: { type: 'string', description: 'One-line package description' },
          installed: { type: 'boolean', description: 'Whether the package is installed' },
          ctanUrl: { type: 'string', description: 'CTAN page for the package' },
        },
      },
    },
    totalMatches: {
      type: 'number',
      description: 'Total number of packages matching the query, before truncation',
    },
  },
}
