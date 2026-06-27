import { LatexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LatexBlockDisplay = {
  type: 'latex',
  name: 'LaTeX',
  description: 'Compile LaTeX documents into PDFs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: LatexIcon,
  longDescription:
    'Integrates LaTeX into the workflow. Compiles LaTeX source into a PDF file with pdflatex, xelatex, lualatex, platex, uplatex, or context, and supports additional resources such as images, included .tex files, and bibliographies. Can also look up the TeX Live packages and system fonts available to the compiler. Does not require OAuth or an API key. Compilation runs on the public LaTeX-on-HTTP service (latex.ytotech.com), so document source and resources are sent to that third-party service.',
  docsLink: 'https://docs.sim.ai/integrations/latex',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

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
