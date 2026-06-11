import type { LatexGetPackageParams, LatexGetPackageResponse } from '@/tools/latex/types'
import type { ToolConfig } from '@/tools/types'

export const latexGetPackageTool: ToolConfig<LatexGetPackageParams, LatexGetPackageResponse> = {
  id: 'latex_get_package',
  name: 'LaTeX Get Package',
  description:
    'Get details about a specific TeX Live package available to the LaTeX compiler, including whether it is installed, its description, license, and related packages.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact package name, e.g. amsmath, tikz, or biblatex',
    },
  },

  request: {
    url: (params) => `https://latex.ytotech.com/packages/${encodeURIComponent(params.name.trim())}`,
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as {
      error?: string
      package?: {
        package?: string
        installed?: boolean
        shortdesc?: string
        longdesc?: string
        category?: string
        'cat-license'?: string
        'cat-topics'?: string[]
        'cat-related'?: string
        'cat-contact-home'?: string
        url_ctan?: string
      }
    }

    const pkg = data.package
    if (!response.ok || data.error || !pkg?.package) {
      return {
        success: false,
        error:
          data.error ||
          (response.ok ? 'Package not found' : `LaTeX package lookup failed (${response.status})`),
        output: {
          package: {
            name: '',
            installed: false,
            shortDescription: null,
            longDescription: null,
            category: null,
            license: null,
            topics: [],
            relatedPackages: [],
            homepage: null,
            ctanUrl: null,
          },
        },
      }
    }

    return {
      success: true,
      output: {
        package: {
          name: pkg.package,
          installed: pkg.installed ?? false,
          shortDescription: pkg.shortdesc ?? null,
          longDescription: pkg.longdesc ?? null,
          category: pkg.category ?? null,
          license: pkg['cat-license'] ?? null,
          topics: pkg['cat-topics'] ?? [],
          relatedPackages: pkg['cat-related']
            ? pkg['cat-related'].split(/\s+/).filter(Boolean)
            : [],
          homepage: pkg['cat-contact-home'] ?? null,
          ctanUrl: pkg.url_ctan ?? null,
        },
      },
    }
  },

  outputs: {
    package: {
      type: 'json',
      description: 'TeX Live package details',
      properties: {
        name: { type: 'string', description: 'Package name' },
        installed: { type: 'boolean', description: 'Whether the package is installed' },
        shortDescription: {
          type: 'string',
          description: 'One-line package description',
          optional: true,
        },
        longDescription: {
          type: 'string',
          description: 'Full package description',
          optional: true,
        },
        category: { type: 'string', description: 'Package category', optional: true },
        license: { type: 'string', description: 'Package license identifier', optional: true },
        topics: { type: 'array', description: 'CTAN topic tags' },
        relatedPackages: { type: 'array', description: 'Names of related packages' },
        homepage: { type: 'string', description: 'Package homepage URL', optional: true },
        ctanUrl: { type: 'string', description: 'CTAN page for the package', optional: true },
      },
    },
  },
}
