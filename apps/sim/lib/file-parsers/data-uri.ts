import { FileParserError } from '@/lib/file-parsers/errors'

export interface DecodedDataUri {
  buffer: Buffer
  mediaType: string | null
}

const MAX_SAFE_BASE64_INPUT_BYTES = Math.floor(Number.MAX_SAFE_INTEGER / 4) * 3
const MAX_SAFE_PERCENT_INPUT_BYTES = Math.floor((Number.MAX_SAFE_INTEGER - 4) / 4)
const MAX_BASE64_WHITESPACE_BYTES = 4 * 1024 * 1024
const MAX_DATA_URI_DESCRIPTOR_CHARACTERS = 4096

function getMaxBase64EncodedLength(maxBytes: number): number {
  if (maxBytes > MAX_SAFE_BASE64_INPUT_BYTES) return Number.MAX_SAFE_INTEGER
  return Math.ceil(maxBytes / 3) * 4
}

function getBase64WhitespaceAllowance(maxEncodedLength: number): number {
  return Math.min(Math.max(1024, Math.ceil(maxEncodedLength / 32)), MAX_BASE64_WHITESPACE_BYTES)
}

function getMaxBase64TransportLength(maxEncodedLength: number): number {
  if (maxEncodedLength === Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  const whitespaceAllowance = getBase64WhitespaceAllowance(maxEncodedLength)
  if (maxEncodedLength > Math.floor((Number.MAX_SAFE_INTEGER - whitespaceAllowance) / 3)) {
    return Number.MAX_SAFE_INTEGER
  }
  return maxEncodedLength * 3 + whitespaceAllowance
}

function getMaxPercentEncodedLength(maxBytes: number): number {
  if (maxBytes > MAX_SAFE_PERCENT_INPUT_BYTES) return Number.MAX_SAFE_INTEGER
  return maxBytes * 4 + 4
}

/**
 * Decodes a data URI without allowing its encoded or decoded representation to
 * exceed the caller's byte budget. The first comma is the delimiter; later
 * commas are payload and must be preserved.
 */
export function decodeDataUriWithinLimit(dataUri: string, maxBytes: number): DecodedDataUri {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Data URI byte limit must be a non-negative safe integer')
  }

  const commaIndex = dataUri.indexOf(',')
  if (dataUri.slice(0, 5).toLowerCase() !== 'data:' || commaIndex < 5) {
    throw new FileParserError('invalid_format', 'Invalid data URI format')
  }
  if (commaIndex - 5 > MAX_DATA_URI_DESCRIPTOR_CHARACTERS) {
    throw new FileParserError(
      'complexity_limit',
      `Data URI descriptor exceeds the safe limit of ${MAX_DATA_URI_DESCRIPTOR_CHARACTERS} characters`
    )
  }

  const descriptor = dataUri.slice(5, commaIndex)
  const descriptorParts = descriptor.split(';')
  const mediaType = descriptorParts[0]?.trim() || null
  const isBase64 = descriptorParts.slice(1).some((part) => part.toLowerCase() === 'base64')
  const payloadStart = commaIndex + 1
  const encodedPayloadLength = dataUri.length - payloadStart
  const encodedCharacterLimit = isBase64
    ? getMaxBase64TransportLength(getMaxBase64EncodedLength(maxBytes))
    : getMaxPercentEncodedLength(maxBytes)
  if (encodedPayloadLength > encodedCharacterLimit) {
    throw new FileParserError(
      'complexity_limit',
      `Data URI encoded payload exceeds the safe limit for a ${maxBytes}-byte file`
    )
  }

  if (isBase64) {
    const maxBase64EncodedLength = getMaxBase64EncodedLength(maxBytes)
    const whitespaceAllowance = getBase64WhitespaceAllowance(maxBase64EncodedLength)
    let base64CharacterCount = 0
    let whitespaceTransportLength = 0
    for (let index = payloadStart; index < dataUri.length; index++) {
      let character = dataUri[index]
      let transportLength = 1
      if (character === '%') {
        const hex = dataUri.slice(index + 1, index + 3)
        if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
          throw new FileParserError('invalid_format', 'Invalid percent-encoded data URI payload')
        }
        character = String.fromCharCode(Number.parseInt(hex, 16))
        transportLength = 3
        index += 2
      }
      if (/\s/.test(character)) {
        whitespaceTransportLength += transportLength
        if (whitespaceTransportLength > whitespaceAllowance) {
          throw new FileParserError(
            'complexity_limit',
            `Data URI encoded payload exceeds the safe limit for a ${maxBytes}-byte file`
          )
        }
        continue
      }
      base64CharacterCount++
      if (base64CharacterCount > maxBase64EncodedLength) {
        throw new FileParserError(
          'complexity_limit',
          `Data URI encoded payload exceeds the safe limit for a ${maxBytes}-byte file`
        )
      }
    }
  }

  const encodedPayload = dataUri.slice(payloadStart)

  let buffer: Buffer
  if (isBase64) {
    const compactPayload = encodedPayload
      .replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      )
      .replace(/\s/g, '')
    const paddingIndex = compactPayload.indexOf('=')
    const unpaddedLength = paddingIndex === -1 ? compactPayload.length : paddingIndex
    const paddingLength = compactPayload.length - unpaddedLength
    const remainder = unpaddedLength % 4
    const invalidPadding =
      paddingLength > 2 ||
      (paddingLength > 0 && compactPayload.length % 4 !== 0) ||
      (paddingLength === 1 && remainder !== 3) ||
      (paddingLength === 2 && remainder !== 2)

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compactPayload) || remainder === 1 || invalidPadding) {
      throw new FileParserError('invalid_format', 'Invalid base64 data URI payload')
    }
    const normalizedPayload =
      paddingLength === 0
        ? compactPayload.padEnd(compactPayload.length + ((4 - remainder) % 4), '=')
        : compactPayload
    buffer = Buffer.from(normalizedPayload, 'base64')
  } else {
    const inputBoundedCapacity =
      encodedPayloadLength > MAX_SAFE_PERCENT_INPUT_BYTES
        ? Number.MAX_SAFE_INTEGER
        : encodedPayloadLength * 3 + 1
    const decoded = Buffer.allocUnsafe(Math.min(maxBytes + 1, inputBoundedCapacity))
    let decodedLength = 0
    const appendByte = (byte: number): void => {
      if (decodedLength <= maxBytes) decoded[decodedLength++] = byte
    }

    for (let index = 0; index < encodedPayload.length && decodedLength <= maxBytes; index++) {
      const codeUnit = encodedPayload.charCodeAt(index)
      if (codeUnit === 0x25) {
        const hex = encodedPayload.slice(index + 1, index + 3)
        if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
          throw new FileParserError('invalid_format', 'Invalid percent-encoded data URI payload')
        }
        appendByte(Number.parseInt(hex, 16))
        index += 2
      } else if (codeUnit <= 0x7f) {
        appendByte(codeUnit)
      } else {
        const codePoint = encodedPayload.codePointAt(index)!
        for (const byte of Buffer.from(String.fromCodePoint(codePoint), 'utf8')) appendByte(byte)
        if (codePoint > 0xffff) index++
      }
    }
    buffer = decoded.subarray(0, decodedLength)
  }

  if (buffer.length > maxBytes) {
    throw new FileParserError(
      'complexity_limit',
      `Data URI decoded payload is ${buffer.length} bytes, exceeding the safe limit of ${maxBytes} bytes`
    )
  }

  return { buffer, mediaType }
}
