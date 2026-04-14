/**
 * Generic document generation worker.
 * Runs in a separate Node.js process, communicates with parent via IPC.
 * Supports pptx (pptxgenjs), docx (docx), and pdf (pdf-lib).
 */

'use strict'

const vm = require('node:vm')

const EXECUTION_TIMEOUT_MS = 30_000
const FILE_REQUEST_TIMEOUT_MS = 30_000

const FORMATS = {
  pptx: {
    setup() {
      const PptxGenJS = require('pptxgenjs')
      const pptx = new PptxGenJS()
      return { globals: { pptx }, pptx }
    },
    async serialize(ctx) {
      const output = await ctx.pptx.write({ outputType: 'nodebuffer' })
      return Buffer.from(output)
    },
  },
  docx: {
    setup() {
      const docx = require('docx')
      const _sections = []
      return { globals: { docx, addSection: (s) => _sections.push(s) }, _sections, docx }
    },
    async serialize(ctx) {
      if (ctx.globals.doc) {
        return ctx.docx.Packer.toBuffer(ctx.globals.doc)
      }
      if (ctx._sections.length > 0) {
        const doc = new ctx.docx.Document({ sections: ctx._sections })
        return ctx.docx.Packer.toBuffer(doc)
      }
      throw new Error(
        'No document created. Use addSection({ children: [...] }) for chunked writes, or set doc = new docx.Document({...}) for a single write.'
      )
    },
  },
  pdf: {
    async setup() {
      const PDFLib = require('pdf-lib')
      const pdf = await PDFLib.PDFDocument.create()

      async function embedImage(dataUri) {
        const base64 = dataUri.split(',')[1]
        const bytes = Buffer.from(base64, 'base64')
        const mime = dataUri.split(';')[0].split(':')[1] || ''
        if (mime.includes('png')) return pdf.embedPng(bytes)
        return pdf.embedJpg(bytes)
      }

      return { globals: { PDFLib, pdf, embedImage }, pdf }
    },
    async serialize(ctx) {
      const pdf = ctx.globals.pdf
      if (!pdf)
        throw new Error(
          'No PDF document. Use the injected pdf object or load one with PDFLib.PDFDocument.load().'
        )
      const bytes = await pdf.save()
      return Buffer.from(bytes)
    },
  },
}

const pendingFileRequests = new Map()
let fileRequestCounter = 0

function sendToParent(msg) {
  if (process.send && process.connected) {
    process.send(msg)
    return true
  }
  return false
}

process.on('message', async (msg) => {
  if (msg.type === 'generate') {
    await handleGenerate(msg)
  } else if (msg.type === 'fileResult') {
    handleFileResult(msg)
  }
})

async function handleGenerate(msg) {
  const { code, format } = msg

  try {
    const formatConfig = FORMATS[format]
    if (!formatConfig) throw new Error(`Unknown document format: ${format}`)

    const ctx = await formatConfig.setup()

    const getFileBase64 = (fileId) =>
      new Promise((resolve, reject) => {
        if (typeof fileId !== 'string' || fileId.length === 0) {
          reject(new Error('fileId must be a non-empty string'))
          return
        }

        const fileReqId = ++fileRequestCounter
        const timeout = setTimeout(() => {
          if (pendingFileRequests.has(fileReqId)) {
            pendingFileRequests.delete(fileReqId)
            reject(new Error(`File request timed out for fileId: ${fileId}`))
          }
        }, FILE_REQUEST_TIMEOUT_MS)

        pendingFileRequests.set(fileReqId, { resolve, reject, timeout })

        if (!sendToParent({ type: 'getFile', fileReqId, fileId })) {
          clearTimeout(timeout)
          pendingFileRequests.delete(fileReqId)
          reject(new Error('Parent process disconnected'))
        }
      })

    const sandbox = Object.create(null)
    Object.assign(sandbox, ctx.globals)
    sandbox.getFileBase64 = getFileBase64

    vm.createContext(sandbox)

    const promise = vm.runInContext(`(async () => { ${code} })()`, sandbox, {
      timeout: EXECUTION_TIMEOUT_MS,
      filename: `${format}-code.js`,
    })
    await promise

    ctx.globals = sandbox

    const output = await formatConfig.serialize(ctx)
    const base64 = Buffer.from(output).toString('base64')
    sendToParent({ type: 'result', data: base64 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendToParent({ type: 'error', message })
  }
}

function handleFileResult(msg) {
  const { fileReqId, data, error } = msg
  const pending = pendingFileRequests.get(fileReqId)
  if (!pending) return

  clearTimeout(pending.timeout)
  pendingFileRequests.delete(fileReqId)

  if (error) {
    pending.reject(new Error(error))
  } else {
    pending.resolve(data)
  }
}

sendToParent({ type: 'ready' })
