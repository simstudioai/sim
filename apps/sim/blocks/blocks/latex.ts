import { LatexBlockDisplay } from '@/blocks/blocks/latex.display'
import type { BlockConfig } from '@/blocks/types'
import type { LatexResponse } from '@/tools/latex/types'

export const LatexBlock: BlockConfig<LatexResponse> = {
  ...LatexBlockDisplay,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Compile Document', id: 'latex_compile' },
        { label: 'Search Packages', id: 'latex_search_packages' },
        { label: 'Get Package Details', id: 'latex_get_package' },
        { label: 'List Fonts', id: 'latex_list_fonts' },
      ],
      value: () => 'latex_compile',
    },
    // Compile Document operation inputs
    {
      id: 'content',
      title: 'LaTeX Source',
      type: 'long-input',
      placeholder:
        '\\documentclass{article}\n\\begin{document}\nHello, world! $E = mc^2$\n\\end{document}',
      rows: 10,
      condition: { field: 'operation', value: 'latex_compile' },
      required: true,
    },
    {
      id: 'compiler',
      title: 'Compiler',
      type: 'dropdown',
      options: [
        { label: 'pdfLaTeX', id: 'pdflatex' },
        { label: 'XeLaTeX', id: 'xelatex' },
        { label: 'LuaLaTeX', id: 'lualatex' },
        { label: 'pLaTeX', id: 'platex' },
        { label: 'upLaTeX', id: 'uplatex' },
        { label: 'ConTeXt', id: 'context' },
      ],
      value: () => 'pdflatex',
      condition: { field: 'operation', value: 'latex_compile' },
    },
    {
      id: 'resources',
      title: 'Resources',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[{"path": "refs.bib", "content": "..."}]',
      condition: { field: 'operation', value: 'latex_compile' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of supporting files for a LaTeX compilation based on the user's description. Each entry must have a "path" (relative file path the LaTeX source references) plus exactly one of:
- "content": plain-text file content (for .tex, .bib, .cls, .sty files)
- "url": URL to download the file from (for images or other binary files)
- "file": base64-encoded file content

Example:
[{"path": "refs.bib", "content": "@article{knuth1984, author={Donald Knuth}, title={Literate Programming}, journal={The Computer Journal}, year={1984}}"}, {"path": "logo.png", "url": "https://example.com/logo.png"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the supporting files you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'document.pdf',
      condition: { field: 'operation', value: 'latex_compile' },
    },
    // Search Packages operation inputs
    {
      id: 'packageQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search package names and descriptions (e.g. "chemistry", "tikz")...',
      condition: { field: 'operation', value: 'latex_search_packages' },
      required: true,
    },
    // Get Package Details operation inputs
    {
      id: 'packageName',
      title: 'Package Name',
      type: 'short-input',
      placeholder: 'Exact package name (e.g. amsmath, tikz, biblatex)',
      condition: { field: 'operation', value: 'latex_get_package' },
      required: true,
    },
    // List Fonts operation inputs
    {
      id: 'fontQuery',
      title: 'Font Filter',
      type: 'short-input',
      placeholder: 'Filter by font family or name (e.g. "Noto Serif")...',
      condition: { field: 'operation', value: 'latex_list_fonts' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '25',
      condition: {
        field: 'operation',
        value: ['latex_search_packages', 'latex_list_fonts'],
      },
    },
  ],
  tools: {
    access: ['latex_compile', 'latex_search_packages', 'latex_get_package', 'latex_list_fonts'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'latex_search_packages':
            return 'latex_search_packages'
          case 'latex_get_package':
            return 'latex_get_package'
          case 'latex_list_fonts':
            return 'latex_list_fonts'
          default:
            return 'latex_compile'
        }
      },
      params: (params) => {
        const {
          operation,
          compiler,
          fileName,
          resources,
          packageQuery,
          packageName,
          fontQuery,
          maxResults,
          ...rest
        } = params

        const parsedMaxResults = Number(maxResults)
        const maxResultsParam =
          Number.isFinite(parsedMaxResults) && parsedMaxResults > 0
            ? { maxResults: parsedMaxResults }
            : {}

        if (operation === 'latex_search_packages') {
          return {
            query: packageQuery,
            ...maxResultsParam,
          }
        }

        if (operation === 'latex_get_package') {
          const effectivePackageName = typeof packageName === 'string' ? packageName.trim() : ''
          if (!effectivePackageName) {
            throw new Error('Package name is required.')
          }
          return { name: effectivePackageName }
        }

        if (operation === 'latex_list_fonts') {
          return {
            ...(typeof fontQuery === 'string' && fontQuery.trim() ? { query: fontQuery } : {}),
            ...maxResultsParam,
          }
        }

        let parsedResources: unknown
        if (typeof resources === 'string' && resources.trim()) {
          try {
            parsedResources = JSON.parse(resources)
          } catch {
            throw new Error('Resources must be a valid JSON array.')
          }
        } else if (Array.isArray(resources)) {
          parsedResources = resources
        }

        return {
          ...rest,
          compiler: typeof compiler === 'string' && compiler.trim() ? compiler : undefined,
          fileName: typeof fileName === 'string' && fileName.trim() ? fileName : undefined,
          resources: parsedResources,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    // Compile Document operation
    content: { type: 'string', description: 'LaTeX source of the main document' },
    compiler: { type: 'string', description: 'LaTeX compiler to use' },
    resources: { type: 'json', description: 'Supporting files for the compilation' },
    fileName: { type: 'string', description: 'Name for the generated PDF file' },
    // Search Packages operation
    packageQuery: { type: 'string', description: 'Package search terms' },
    // Get Package Details operation
    packageName: { type: 'string', description: 'Exact TeX Live package name' },
    // List Fonts operation
    fontQuery: { type: 'string', description: 'Font family or name filter' },
    maxResults: { type: 'number', description: 'Maximum results to return' },
  },
  outputs: {
    // Compile Document output
    pdf: { type: 'file', description: 'Compiled PDF file' },
    pdfUrl: { type: 'string', description: 'URL of the compiled PDF' },
    fileName: { type: 'string', description: 'Name of the compiled PDF file' },
    compiler: { type: 'string', description: 'LaTeX compiler used for the build' },
    // Search Packages output
    packages: {
      type: 'json',
      description: 'Matching TeX Live packages [{name, shortDescription, installed, ctanUrl}]',
    },
    // Get Package Details output
    package: {
      type: 'json',
      description:
        'Package details (name, installed, shortDescription, longDescription, category, license, topics, relatedPackages, homepage, ctanUrl)',
    },
    // List Fonts output
    fonts: { type: 'json', description: 'Available fonts [{family, name, styles}]' },
    // Shared search/list output
    totalMatches: { type: 'number', description: 'Total matches found before truncation' },
  },
}
