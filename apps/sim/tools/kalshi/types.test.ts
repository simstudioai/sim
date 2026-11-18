import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { generateKalshiSignature } from '@/tools/kalshi/types'

const TIMESTAMP = '1700000000000'
const PATH = '/trade-api/v2/portfolio/orders'
const SIGNED_TEXT = `${TIMESTAMP}GET${PATH}`

function ed25519Pair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey }
}

function rsaPkcs8Pair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey }
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

  it('signs a PKCS#8 RSA key, whose PEM header matches an Ed25519 one, with RSA-PSS', () => {
    const { pem, publicKey } = rsaPkcs8Pair()
    expect(verifiesRsaPss(publicKey, generateKalshiSignature(pem, TIMESTAMP, 'GET', PATH))).toBe(
      true
    )
  })

  it('refuses a key of a type Kalshi does not verify', () => {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => generateKalshiSignature(pem, TIMESTAMP, 'GET', PATH)).toThrow(/RSA or Ed25519/)
  })
})
