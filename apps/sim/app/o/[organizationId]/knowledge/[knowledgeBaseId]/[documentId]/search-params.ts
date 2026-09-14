import { createLoader, createParser, createSerializer } from 'nuqs/server'

const parseAsDocumentPosition = createParser({
  parse: (value) => {
    if (!/^\d+$/.test(value)) return null
    const position = Number(value)
    return Number.isSafeInteger(position) && position <= 2147483647 ? position : null
  },
  serialize: String,
}).withDefault(0)

export const documentReadParams = {
  startChunkIndex: parseAsDocumentPosition,
  startOffset: parseAsDocumentPosition,
}

const documentReadUrlKeys = {
  urlKeys: {
    startChunkIndex: 'start-chunk-index',
    startOffset: 'start-offset',
  },
} as const

export const loadDocumentReadParams = createLoader(documentReadParams, documentReadUrlKeys)
export const serializeDocumentReadParams = createSerializer(documentReadParams, documentReadUrlKeys)
