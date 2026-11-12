import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { buildKalshiAuthHeaders, generateKalshiSignature } from '@/tools/kalshi/types'

const TIMESTAMP = '1700000000000'
const PATH = '/trade-api/v2/portfolio/orders'
const SIGNED_TEXT = `${TIMESTAMP}GET${PATH}`

function ed25519Pair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey }
}

function rsaPair(type: 'pkcs1' | 'pkcs8') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { pem: privateKey.export({ type, format: 'pem' }).toString(), publicKey }
}

function verifiesRsaPss(publicKey: crypto.KeyObject, signature: string): boolean {
  return crypto.verify(
    'sha256',
    Buffer.from(SIGNED_TEXT),
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    Buffer.from(signature, 'base64')
  )
}

describe('generateKalshiSignature', () => {
  it('signs with an Ed25519 key, the type Kalshi generates by default', () => {
    const { pem, publicKey } = ed25519Pair()
    const signature = generateKalshiSignature(pem, TIMESTAMP, 'get', PATH)
    expect(
      crypto.verify(null, Buffer.from(SIGNED_TEXT), publicKey, Buffer.from(signature, 'base64'))
    ).toBe(true)
  })

  it('signs a PKCS#1 RSA key with RSA-PSS SHA-256', () => {
    const { pem, publicKey } = rsaPair('pkcs1')
    expect(verifiesRsaPss(publicKey, generateKalshiSignature(pem, TIMESTAMP, 'GET', PATH))).toBe(
      true
    )
  })

  it('signs a PKCS#8 RSA key, whose PEM header matches an Ed25519 one, with RSA-PSS', () => {
    const { pem, publicKey } = rsaPair('pkcs8')
    expect(verifiesRsaPss(publicKey, generateKalshiSignature(pem, TIMESTAMP, 'GET', PATH))).toBe(
      true
    )
  })

  it('signs only the path, dropping the query string', () => {
    const { pem, publicKey } = ed25519Pair()
    const signature = generateKalshiSignature(pem, TIMESTAMP, 'GET', `${PATH}?limit=1`)
    expect(
      crypto.verify(null, Buffer.from(SIGNED_TEXT), publicKey, Buffer.from(signature, 'base64'))
    ).toBe(true)
  })

  it('signs a key pasted with literal \\n sequences on one line', () => {
    const { pem, publicKey } = ed25519Pair()
    const signature = generateKalshiSignature(pem.replace(/\n/g, '\\n'), TIMESTAMP, 'GET', PATH)
    expect(
      crypto.verify(null, Buffer.from(SIGNED_TEXT), publicKey, Buffer.from(signature, 'base64'))
    ).toBe(true)
  })

  it('refuses a key of a type Kalshi does not verify', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => generateKalshiSignature(pem, TIMESTAMP, 'GET', PATH)).toThrow(/RSA or Ed25519/)
  })
})

describe('buildKalshiAuthHeaders', () => {
  it('sends the key id, millisecond timestamp, and a signature over them', () => {
    const { pem, publicKey } = ed25519Pair()
    const headers = buildKalshiAuthHeaders('key-id', pem, 'GET', PATH)
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key-id')
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toMatch(/^\d{13}$/)
    const signed = `${headers['KALSHI-ACCESS-TIMESTAMP']}GET${PATH}`
    expect(
      crypto.verify(
        null,
        Buffer.from(signed),
        publicKey,
        Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64')
      )
    ).toBe(true)
  })
})
