import type { UserFile } from '@/executor/types'
import type { LatexCompileParams, LatexCompileResponse } from '@/tools/latex/types'
import type { ToolConfig } from '@/tools/types'

export const latexCompileTool: ToolConfig<LatexCompileParams, LatexCompileResponse> = {
  id: 'latex_compile',
  name: 'LaTeX Compile',
  description:
    'Compile a LaTeX document into a PDF via the public LaTeX-on-HTTP service (latex.ytotech.com). Supports pdflatex, xelatex, lualatex, platex, uplatex, and context, plus supporting resources such as images, included .tex files, and bibliographies.',
  version: '1.0.0',

  params: {
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LaTeX source of the main document, from \\documentclass to \\end{document}',
    },
    compiler: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'LaTeX compiler: pdflatex (default), xelatex, lualatex, platex, uplatex, or context',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the generated PDF file (default: document.pdf)',
    },
    resources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Supporting files for the compilation. Each entry has a "path" plus exactly one of "content" (plain text), "file" (base64), or "url" (remote file), e.g. [{"path": "refs.bib", "content": "..."}, {"path": "logo.png", "url": "https://..."}]',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path the file is available at' },
          content: { type: 'string', description: 'Plain-text file content' },
          file: { type: 'string', description: 'Base64-encoded file content' },
          url: { type: 'string', description: 'URL the file is downloaded from' },
        },
      },
    },
  },

  request: {
    url: '/api/tools/latex',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: LatexCompileParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      content: params.content,
      compiler: params.compiler,
      fileName: params.fileName,
      resources: params.resources,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as {
      error?: string
      pdfFile?: UserFile
      pdfUrl?: string
      fileName?: string
      compiler?: string
    }

    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'LaTeX compilation failed',
        output: {
          pdf: '',
          pdfUrl: '',
          fileName: '',
          compiler: data.compiler || '',
        },
      }
    }

    const pdf =
      data.pdfFile ||
      (data.pdfUrl
        ? {
            name: data.fileName || 'document.pdf',
            url: data.pdfUrl,
            mimeType: 'application/pdf',
          }
        : '')

    if (!pdf) {
      return {
        success: false,
        error: 'LaTeX compile response did not include a PDF',
        output: {
          pdf: '',
          pdfUrl: '',
          fileName: '',
          compiler: data.compiler || '',
        },
      }
    }

    return {
      success: true,
      output: {
        pdf,
        pdfUrl: data.pdfUrl || '',
        fileName: data.fileName || '',
        compiler: data.compiler || '',
      },
    }
  },

  outputs: {
    pdf: {
      type: 'file',
      description: 'Compiled PDF file',
      fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
    },
    pdfUrl: { type: 'string', description: 'URL of the compiled PDF' },
    fileName: { type: 'string', description: 'Name of the compiled PDF file' },
    compiler: { type: 'string', description: 'LaTeX compiler used for the build' },
  },
}
