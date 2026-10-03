/**
 * Runs the real AWS SigV4 presigner (signing is local, no network) to pin where
 * direct-upload metadata travels. A header the uploader must send but that is
 * missing from `headers`, or a metadata key both signed as a header and hoisted
 * into the query, makes the provider reject or strip the upload.
 */
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { setUploadsConfig, uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)

import { getS3PresignedUploadUrl, resetS3ClientForTesting } from '@/lib/uploads/providers/s3/client'

setEnv({ AWS_ACCESS_KEY_ID: 'test-access-key', AWS_SECRET_ACCESS_KEY: 'test-secret-key' })
afterAll(resetEnvMock)

/** Headers the browser sets itself and the uploader never supplies. */
const TRANSPORT_HEADERS = new Set(['host', 'content-length'])

function configure(endpoint: string | undefined, forcePathStyle = false) {
  setUploadsConfig({
    S3_CONFIG: { bucket: 'sim-files', region: 'de', endpoint, forcePathStyle },
  })
  resetS3ClientForTesting()
}

async function presign() {
  const transfer = await getS3PresignedUploadUrl({
    key: 'kb/upload-1/report.pdf',
    contentType: 'application/pdf',
    fileSize: 3,
    metadata: { uploadId: 'upload-1', originalName: 'Q3 report.pdf' },
    customConfig: { bucket: 'sim-files', region: 'de' },
    expiresIn: 600,
  })
  const url = new URL(transfer.url)
  const signedHeaders = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')
  const queryMetadata = [...url.searchParams.keys()].filter((k) =>
    k.toLowerCase().startsWith('x-amz-meta-')
  )
  const suppliedHeaders = new Set(Object.keys(transfer.headers).map((k) => k.toLowerCase()))
  return { transfer, signedHeaders, queryMetadata, suppliedHeaders }
}

describe('getS3PresignedUploadUrl', () => {
  beforeEach(() => configure(undefined))

  it('signs metadata as uploader-sent headers for a custom S3-compatible endpoint', async () => {
    configure('https://s3.de.io.cloud.ovh.net')
    const { transfer, signedHeaders, queryMetadata } = await presign()

    expect(queryMetadata).toEqual([])
    expect(signedHeaders).toEqual(
      expect.arrayContaining(['x-amz-meta-uploadid', 'x-amz-meta-originalname'])
    )
    expect(transfer.headers).toMatchObject({
      'x-amz-meta-uploadid': 'upload-1',
      'x-amz-meta-originalname': 'Q3 report.pdf',
    })
  })

  it('keeps AWS metadata in the signed query so existing bucket CORS rules still apply', async () => {
    const { signedHeaders, queryMetadata } = await presign()

    expect(queryMetadata.sort()).toEqual(['x-amz-meta-originalname', 'x-amz-meta-uploadid'])
    expect(signedHeaders.some((h) => h.startsWith('x-amz-meta-'))).toBe(false)
  })

  it.each([
    ['AWS', undefined],
    ['custom endpoint', 'https://s3.de.io.cloud.ovh.net'],
  ])('supplies every signed header the uploader controls (%s)', async (_, endpoint) => {
    configure(endpoint)
    const { signedHeaders, suppliedHeaders, queryMetadata } = await presign()

    for (const header of signedHeaders) {
      if (!TRANSPORT_HEADERS.has(header)) expect(suppliedHeaders).toContain(header)
    }
    for (const key of queryMetadata) expect(suppliedHeaders).not.toContain(key.toLowerCase())
  })
})
