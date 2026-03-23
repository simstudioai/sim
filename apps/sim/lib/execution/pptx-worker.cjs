/**
 * Node.js worker for sandboxed PPTX generation.
 * Runs in a separate Node.js process, communicates with parent via IPC.
 */

'use strict'

const vm = require('node:vm')
const PptxGenJS = require('pptxgenjs')

const EXECUTION_TIMEOUT_MS = 30_000
const FILE_REQUEST_TIMEOUT_MS = 30_000

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
  const { code } = msg

  try {
    const pptx = new PptxGenJS()

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
    sandbox.pptx = pptx
    sandbox.getFileBase64 = getFileBase64

    vm.createContext(sandbox)

    const promise = vm.runInContext(`(async () => { ${code} })()`, sandbox, {
      timeout: EXECUTION_TIMEOUT_MS,
      filename: 'pptx-code.js',
    })
    await promise

    const output = await pptx.write({ outputType: 'nodebuffer' })
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
