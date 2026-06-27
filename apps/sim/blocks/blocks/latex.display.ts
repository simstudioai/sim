import { LatexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

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
