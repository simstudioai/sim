import { LatexIcon } from '@/components/icons'
import { LatexBlockDisplay } from '@/blocks/blocks/latex.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
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

export const LatexBlockMeta = {
  tags: ['document-processing'],
  url: 'https://www.latex-project.org',
  templates: [
    {
      icon: LatexIcon,
      title: 'LaTeX invoice generator',
      prompt:
        'Build a workflow that takes invoice line items from a table, fills a LaTeX invoice template, compiles it to PDF, and emails the invoice to the customer.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['documents', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX research report writer',
      prompt:
        'Create a workflow where an agent researches a topic from the knowledge base, writes the findings as a LaTeX article, and compiles a polished PDF report.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['documents', 'research'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX weekly metrics report',
      prompt:
        'Build a scheduled weekly workflow that pulls metrics from a table, typesets a LaTeX report with charts and tables, compiles it to PDF, and posts it to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['documents', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX offer letter generator',
      prompt:
        'Create a workflow that takes candidate details from a form, fills a LaTeX offer letter template, compiles it to PDF, and sends it for e-signature.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['documents', 'hr'],
      alsoIntegrations: ['docusign'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX math worksheet builder',
      prompt:
        'Build a workflow where an agent generates practice problems for a given math topic and difficulty, typesets them with LaTeX equations, and compiles a printable worksheet PDF.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['documents', 'education'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX proposal generator',
      prompt:
        'Create a workflow that pulls deal details from HubSpot, has an agent draft a tailored proposal in LaTeX, compiles it to PDF, and saves it to the deal record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['documents', 'proposals'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX paper digest compiler',
      prompt:
        'Build a scheduled workflow that fetches new ArXiv papers on tracked topics, has an agent summarize each one, typesets the digest as a LaTeX document, and compiles a weekly PDF.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['documents', 'research'],
      alsoIntegrations: ['arxiv'],
    },
    {
      icon: LatexIcon,
      title: 'LaTeX certificate generator',
      prompt:
        'Create a workflow that reads attendee names from a spreadsheet, fills a LaTeX certificate template for each attendee, compiles the PDFs, and emails each certificate to its recipient.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['documents', 'automation'],
      alsoIntegrations: ['google_sheets', 'gmail'],
    },
  ],
  skills: [
    {
      name: 'compile-document-to-pdf',
      description:
        'Compile LaTeX source into a finished PDF, choosing the right compiler and reporting any compilation errors. Use whenever a polished, print-ready document is needed.',
      content:
        '# Compile Document to PDF\n\nTurn LaTeX source into a finished PDF.\n\n## Steps\n1. Assemble the complete LaTeX source, from \\documentclass to \\end{document}.\n2. Pick the compiler: pdflatex for standard documents, xelatex or lualatex when custom fonts or full unicode are needed.\n3. Attach any supporting files (images, included .tex files, .bib bibliographies) as resources with the paths the source references.\n4. Compile and capture the resulting PDF.\n\n## Output\nThe compiled PDF file and its URL. If compilation fails, report the TeX errors verbatim so they can be fixed.',
    },
    {
      name: 'generate-document-from-template',
      description:
        'Fill a LaTeX template with structured data and compile it to PDF. Use for repeatable documents like invoices, certificates, letters, and contracts.',
      content:
        '# Generate Document from Template\n\nProduce a templated document with real data filled in.\n\n## Steps\n1. Start from the LaTeX template and identify its placeholders.\n2. Substitute each placeholder with the provided data, escaping LaTeX special characters (&, %, $, #, _, {, }) in user-supplied values.\n3. Compile the filled-in source to PDF.\n4. Name the output file after the document, e.g. invoice-1042.pdf.\n\n## Output\nA compiled PDF per record, named for its contents. List any records that failed to compile and why.',
    },
    {
      name: 'typeset-math-content',
      description:
        'Write mathematical content — equations, proofs, problem sets — in LaTeX and compile a printable PDF. Use for worksheets, solution sheets, and technical notes.',
      content:
        '# Typeset Math Content\n\nProduce a clean PDF of mathematical material.\n\n## Steps\n1. Draft the content using proper LaTeX math: inline $...$, display equations, and environments like align and theorem as appropriate.\n2. Load only the packages the content needs (amsmath, amssymb, amsthm).\n3. Structure the document with sections and consistent numbering.\n4. Compile to PDF and verify there are no errors.\n\n## Output\nA printable PDF of the typeset material, plus the LaTeX source so it can be edited later.',
    },
    {
      name: 'build-report-with-bibliography',
      description:
        'Compile a report or paper that cites sources, attaching a BibTeX bibliography as a resource. Use for research reports, literature reviews, and academic writing.',
      content:
        '# Build Report with Bibliography\n\nCompile a citing document with its references resolved.\n\n## Steps\n1. Write the report source with \\cite commands and a \\bibliography{refs} (or biblatex equivalent) reference.\n2. Attach the BibTeX entries as a resource at the cited path, e.g. refs.bib.\n3. Compile — the bibliography pass runs automatically.\n4. Check the output for unresolved citation warnings and fix missing entries.\n\n## Output\nThe compiled PDF with a formatted reference list. Note any citations that could not be resolved.',
    },
    {
      name: 'fix-compilation-errors',
      description:
        'Diagnose failed LaTeX builds from the compiler error output and iterate until the document compiles. Use when a compilation returns errors instead of a PDF.',
      content:
        '# Fix Compilation Errors\n\nGet a failing LaTeX document to build.\n\n## Steps\n1. Read the TeX error lines from the failed compile (lines starting with !), which name the problem and its location.\n2. Apply the targeted fix: missing packages (verify availability with Get Package Details or Search Packages), unescaped special characters, unmatched braces or environments, or commands needing a different compiler (e.g. fontspec requires xelatex or lualatex — confirm the font exists with List Fonts).\n3. Recompile and repeat until the build succeeds.\n4. Keep edits minimal — fix the errors without rewriting the document.\n\n## Output\nThe compiled PDF and a short list of the fixes that were applied.',
    },
  ],
} as const satisfies BlockMeta
