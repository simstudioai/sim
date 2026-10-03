/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import {
  buildOciObjectStorageEndpoint,
  createOciObjectStorageClient,
  OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES,
  OCI_LIST_BUCKETS_MAX_RESULTS,
  sendOciListBuckets,
} from '@/lib/internal/oci-object-storage/client'

const connection = {
  accessKeyId: 'ACCESSKEY123',
  secretAccessKey: 'secret-key-canary',
  namespace: 'namespace1',
  region: 'us-ashburn-1',
}

function response(statusCode: number, body = '', headers: Record<string, string> = {}) {
  return {
    response: {
      statusCode,
      headers: {
        'content-type': 'application/xml',
        'opc-request-id': 'request-1',
        ...headers,
      },
      body: Readable.from([body]),
    },
  }
}

describe('OCI Object Storage AWS serializer client', () => {
  it('constructs only the fixed public commercial endpoint', () => {
    expect(buildOciObjectStorageEndpoint('NAMESPACE1', 'US-ASHBURN-1')).toBe(
      'https://namespace1.compat.objectstorage.us-ashburn-1.oci.customer-oci.com'
    )
    expect(() => buildOciObjectStorageEndpoint('namespace.example', 'us-ashburn-1')).toThrow(
      'valid lowercase DNS label'
    )
    expect(() => buildOciObjectStorageEndpoint('namespace1', 'us-gov-ashburn-1')).toThrow(
      'public commercial OC1 region'
    )
  })

  it('signs for the OCI region and S3 service with forced path-style encoding', async () => {
    const handler = {
      handle: vi.fn(async () =>
        response(200, '', {
          'content-length': '12',
          'content-type': 'text/plain',
          etag: '"etag-1"',
          'opc-meta-source': 'oracle-only',
        })
      ),
      destroy: vi.fn(),
    }
    const client = createOciObjectStorageClient(connection, {
      requestHandler: handler as never,
      maxAttempts: 3,
    })

    const output = await client.send(
      new HeadObjectCommand({ Bucket: 'bucket-name', Key: 'folder/a b#c?.txt' })
    )
    const request = handler.handle.mock.calls[0]?.[0] as unknown as {
      hostname: string
      path: string
      headers: Record<string, string>
    }

    expect(request.hostname).toBe(
      'namespace1.compat.objectstorage.us-ashburn-1.oci.customer-oci.com'
    )
    expect(request.path).toBe('/bucket-name/folder/a%20b%23c%3F.txt')
    expect(request.headers.authorization).toContain('Credential=ACCESSKEY123/')
    expect(request.headers.authorization).toContain('/us-ashburn-1/s3/aws4_request')
    expect(output).toMatchObject({
      ContentLength: 12,
      ContentType: 'text/plain',
      ETag: '"etag-1"',
      Metadata: { source: 'oracle-only' },
      $metadata: { requestId: 'request-1' },
    })
    client.destroy()
  })

  it('serializes Oracle-supported listing parameters and deserializes opaque pagination', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>bucket-name</Name><Prefix>folder/</Prefix><KeyCount>1</KeyCount><MaxKeys>25</MaxKeys>
        <Delimiter>/</Delimiter><IsTruncated>true</IsTruncated>
        <ContinuationToken>opaque-current</ContinuationToken>
        <NextContinuationToken>opaque-next+/=</NextContinuationToken>
        <StartAfter>folder/a.txt</StartAfter>
        <Contents><Key>folder/a b.txt</Key><LastModified>2026-09-02T12:00:00.000Z</LastModified><ETag>"etag"</ETag><Size>7</Size><StorageClass>STANDARD</StorageClass></Contents>
        <CommonPrefixes><Prefix>folder/sub/</Prefix></CommonPrefixes>
      </ListBucketResult>`
    const handler = {
      handle: vi.fn(async () => response(200, xml)),
      destroy: vi.fn(),
    }
    const client = createOciObjectStorageClient(connection, {
      requestHandler: handler as never,
      maxAttempts: 3,
    })

    const output = await client.send(
      new ListObjectsV2Command({
        Bucket: 'bucket-name',
        Prefix: 'folder/',
        Delimiter: '/',
        MaxKeys: 25,
        StartAfter: 'folder/a.txt',
        ContinuationToken: 'opaque-current',
      })
    )
    const request = handler.handle.mock.calls[0]?.[0] as unknown as {
      path: string
      query: Record<string, string>
    }

    expect(request.path).toBe('/bucket-name/')
    expect(request.query).toMatchObject({
      'list-type': '2',
      prefix: 'folder/',
      delimiter: '/',
      'max-keys': '25',
      'start-after': 'folder/a.txt',
      'continuation-token': 'opaque-current',
    })
    expect(output).toMatchObject({
      Name: 'bucket-name',
      IsTruncated: true,
      NextContinuationToken: 'opaque-next+/=',
      Contents: [{ Key: 'folder/a b.txt', Size: 7, StorageClass: 'STANDARD' }],
      CommonPrefixes: [{ Prefix: 'folder/sub/' }],
    })
    client.destroy()
  })

  it('deserializes GetService owner data and write response headers', async () => {
    const listXml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Owner><ID>ocid1.user.oc1..owner</ID><DisplayName>Storage Automation</DisplayName></Owner>
        <Buckets><Bucket><Name>documents</Name><CreationDate>2026-09-02T12:00:00.000Z</CreationDate></Bucket></Buckets>
      </ListAllMyBucketsResult>`
    const handler = {
      handle: vi
        .fn()
        .mockResolvedValueOnce(response(200, listXml))
        .mockResolvedValueOnce(
          response(200, '', {
            etag: '"etag-1"',
            'x-amz-checksum-sha256': 'checksum-1',
          })
        )
        .mockResolvedValueOnce(response(204)),
      destroy: vi.fn(),
    }
    const client = createOciObjectStorageClient(connection, {
      requestHandler: handler as never,
      maxAttempts: 1,
    })

    await expect(sendOciListBuckets(client)).resolves.toMatchObject({
      Owner: { ID: 'ocid1.user.oc1..owner', DisplayName: 'Storage Automation' },
      Buckets: [{ Name: 'documents' }],
      $metadata: { requestId: 'request-1' },
    })
    await expect(
      client.send(
        new PutObjectCommand({
          Bucket: 'documents',
          Key: 'reports/a b#.txt',
          Body: Buffer.from('hello'),
          ContentLength: 5,
          ContentType: 'text/plain',
        })
      )
    ).resolves.toMatchObject({
      ETag: '"etag-1"',
      ChecksumSHA256: 'checksum-1',
      $metadata: { requestId: 'request-1' },
    })
    await expect(
      client.send(new DeleteObjectCommand({ Bucket: 'documents', Key: 'reports/a b#.txt' }))
    ).resolves.toMatchObject({ $metadata: { httpStatusCode: 204, requestId: 'request-1' } })

    const putRequest = handler.handle.mock.calls[1]?.[0] as unknown as {
      method: string
      path: string
      headers: Record<string, string>
    }
    const deleteRequest = handler.handle.mock.calls[2]?.[0] as unknown as {
      method: string
      path: string
    }
    expect(putRequest).toMatchObject({
      method: 'PUT',
      path: '/documents/reports/a%20b%23.txt',
      headers: expect.objectContaining({
        'content-length': '5',
        'content-type': 'text/plain',
        'x-amz-content-sha256': expect.any(String),
      }),
    })
    expect(putRequest.headers).not.toHaveProperty('x-amz-sdk-checksum-algorithm')
    expect(putRequest.headers).not.toHaveProperty('x-amz-checksum-crc32')
    expect(deleteRequest).toMatchObject({
      method: 'DELETE',
      path: '/documents/reports/a%20b%23.txt',
    })
    client.destroy()
  })

  it('maps Oracle GetObject request and user-metadata headers before deserialization', async () => {
    const handler = {
      handle: vi.fn(async () =>
        response(200, 'hello', {
          'content-length': '5',
          'content-type': 'text/plain',
          'opc-meta-source': 'oracle-get',
        })
      ),
      destroy: vi.fn(),
    }
    const client = createOciObjectStorageClient(connection, {
      requestHandler: handler as never,
      maxAttempts: 3,
    })

    const output = await client.send(
      new GetObjectCommand({ Bucket: 'documents', Key: 'reports/a.txt' })
    )
    const request = handler.handle.mock.calls[0]?.[0] as unknown as {
      headers: Record<string, string>
    }
    expect(output).toMatchObject({
      ContentLength: 5,
      ContentType: 'text/plain',
      Metadata: { source: 'oracle-get' },
      $metadata: { requestId: 'request-1' },
    })
    expect(request.headers).not.toHaveProperty('x-amz-checksum-mode')
    await expect(output.Body?.transformToString()).resolves.toBe('hello')
    client.destroy()
  })

  it('does not follow provider redirects to another host', async () => {
    for (const statusCode of [301, 307]) {
      const handler = {
        handle: vi.fn(async () =>
          response(statusCode, '<Error><Code>PermanentRedirect</Code></Error>', {
            location: 'https://attacker.example/steal',
            'x-amz-bucket-region': 'us-phoenix-1',
          })
        ),
        destroy: vi.fn(),
      }
      const client = createOciObjectStorageClient(connection, {
        requestHandler: handler as never,
        maxAttempts: 3,
      })

      await expect(
        client.send(new ListObjectsV2Command({ Bucket: 'documents', MaxKeys: 1 }))
      ).rejects.toBeDefined()
      expect(handler.handle).toHaveBeenCalledOnce()
      const request = handler.handle.mock.calls[0]?.[0] as unknown as { hostname: string }
      expect(request.hostname).toBe(
        'namespace1.compat.objectstorage.us-ashburn-1.oci.customer-oci.com'
      )
      client.destroy()
    }
  })

  it('bounds unpaginated ListBuckets bytes and result cardinality', async () => {
    const oversizedHandler = {
      handle: vi.fn(async () =>
        response(200, '<ListAllMyBucketsResult/>', {
          'content-length': String(OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES + 1),
        })
      ),
      destroy: vi.fn(),
    }
    const oversizedClient = createOciObjectStorageClient(connection, {
      requestHandler: oversizedHandler as never,
      maxAttempts: 1,
    })
    await expect(oversizedClient.send(new ListBucketsCommand({}))).rejects.toThrow(
      'OCI bucket listing exceeds maximum size'
    )
    oversizedClient.destroy()

    const streamingHandler = {
      handle: vi.fn(async () => ({
        response: {
          statusCode: 200,
          headers: { 'content-type': 'application/xml', 'opc-request-id': 'request-1' },
          body: Readable.from([
            Buffer.alloc(OCI_LIST_BUCKETS_MAX_RESPONSE_BYTES),
            Buffer.from('x'),
          ]),
        },
      })),
      destroy: vi.fn(),
    }
    const streamingClient = createOciObjectStorageClient(connection, {
      requestHandler: streamingHandler as never,
      maxAttempts: 1,
    })
    await expect(streamingClient.send(new ListBucketsCommand({}))).rejects.toThrow(
      'OCI bucket listing exceeds maximum size'
    )
    streamingClient.destroy()

    const send = vi.fn(async () => ({
      Buckets: Array.from({ length: OCI_LIST_BUCKETS_MAX_RESULTS + 1 }, (_, index) => ({
        Name: `bucket-${index}`,
      })),
    }))
    await expect(sendOciListBuckets({ send } as never)).rejects.toMatchObject({ status: 413 })
  })

  it('uses up to three attempts for reads and one attempt for writes', async () => {
    const readHandler = {
      handle: vi
        .fn()
        .mockResolvedValueOnce(response(500, '<Error><Code>InternalError</Code></Error>'))
        .mockResolvedValueOnce(response(500, '<Error><Code>InternalError</Code></Error>'))
        .mockResolvedValueOnce(
          response(
            200,
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><KeyCount>0</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>'
          )
        ),
      destroy: vi.fn(),
    }
    const readClient = createOciObjectStorageClient(connection, {
      requestHandler: readHandler as never,
      maxAttempts: 3,
    })
    await expect(
      readClient.send(new ListObjectsV2Command({ Bucket: 'b', MaxKeys: 1 }))
    ).resolves.toMatchObject({ IsTruncated: false })
    expect(readHandler.handle).toHaveBeenCalledTimes(3)
    readClient.destroy()

    const writeHandler = {
      handle: vi.fn(async () => response(500, '<Error><Code>InternalError</Code></Error>')),
      destroy: vi.fn(),
    }
    const writeClient = createOciObjectStorageClient(connection, {
      requestHandler: writeHandler as never,
      maxAttempts: 1,
    })
    await expect(
      writeClient.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: 'value' }))
    ).rejects.toBeDefined()
    expect(writeHandler.handle).toHaveBeenCalledOnce()
    writeClient.destroy()
  })

  it('propagates aborts and rejects malformed provider XML', async () => {
    const controller = new AbortController()
    const abortHandler = {
      handle: vi.fn(
        async (_request: unknown, options: { abortSignal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            if (options.abortSignal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            options.abortSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            )
          })
      ),
      destroy: vi.fn(),
    }
    const abortClient = createOciObjectStorageClient(connection, {
      requestHandler: abortHandler as never,
      maxAttempts: 3,
    })
    const pending = abortClient.send(new ListObjectsV2Command({ Bucket: 'b' }), {
      abortSignal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abortClient.destroy()

    const malformedHandler = {
      handle: vi.fn(async () => response(200, '<ListBucketResult><Contents>')),
      destroy: vi.fn(),
    }
    const malformedClient = createOciObjectStorageClient(connection, {
      requestHandler: malformedHandler as never,
      maxAttempts: 3,
    })
    await expect(
      malformedClient.send(new ListObjectsV2Command({ Bucket: 'b' }))
    ).rejects.toBeDefined()
    malformedClient.destroy()
  })
})
