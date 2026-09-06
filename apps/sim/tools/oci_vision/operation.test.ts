/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OciVisionBlock } from '@/blocks/blocks/oci_vision'
import {
  ociVisionAnalyzeImageTool,
  ociVisionCancelImageJobTool,
  ociVisionCreateImageJobTool,
  ociVisionDownloadImageJobOutputTool,
  ociVisionGetImageJobTool,
  ociVisionGetModelTool,
  ociVisionGetProjectTool,
  ociVisionListImageJobOutputsTool,
  ociVisionListModelsTool,
  ociVisionListProjectsTool,
} from '@/tools/oci_vision'
import { OCI_VISION_OPERATIONS } from '@/tools/oci_vision/shared'

const tools = [
  ociVisionAnalyzeImageTool,
  ociVisionCreateImageJobTool,
  ociVisionGetImageJobTool,
  ociVisionCancelImageJobTool,
  ociVisionListProjectsTool,
  ociVisionGetProjectTool,
  ociVisionListModelsTool,
  ociVisionGetModelTool,
  ociVisionListImageJobOutputsTool,
  ociVisionDownloadImageJobOutputTool,
]

describe('OCI Vision operation declarations', () => {
  it('declares the complete ten-operation family', () => {
    expect(tools.map((tool) => tool.id)).toEqual(
      OCI_VISION_OPERATIONS.map((operation) => `oci_vision_${operation}`)
    )
  })

  it.each(tools)('$id uses the internal operation path and existing OCI credentials', (tool) => {
    expect(tool.operation.input).toBeTypeOf('function')
    expect('request' in tool).toBe(false)
    expect(tool.oauth).toEqual({
      required: true,
      provider: 'oci_vision',
      credentialKind: 'service-account',
    })
    expect(tool.params.accessToken.visibility).toBe('hidden')
    expect(tool.params.oauthCredential.visibility).toBe('user-only')
  })

  it('uses only the executor-resolved credential and explicit tool fields', () => {
    expect(
      ociVisionGetImageJobTool.operation.input({
        oauthCredential: 'supplied-alias',
        accessToken: 'resolved-credential',
        imageJobId: 'job-1',
      })
    ).toEqual({ credentialId: 'resolved-credential', region: undefined, imageJobId: 'job-1' })
    expect(
      ociVisionGetImageJobTool.operation.input({
        oauthCredential: 'unresolved-alias',
        imageJobId: 'job-1',
      })
    ).toHaveProperty('credentialId', '')
  })

  it('tracks model-bound inline content while preserving locator/control semantics', () => {
    const modelInput = ociVisionAnalyzeImageTool.operation.modelInput
    if (modelInput?.mode !== 'private-provenance') throw new Error('Missing private provenance')
    const file = {
      name: 'a.png',
      key: 'workspace/w/a.png',
      size: 10,
      base64: 'resolved-secret-canary',
    }
    const base = {
      oauthCredential: 'c',
      source: 'file' as const,
      features: ['TEXT_DETECTION' as const],
    }
    expect(modelInput.inputPaths({ ...base, file })).toEqual([['file', 'base64']])
    expect(modelInput.inputPaths({ ...base, file: { ...file, base64: undefined } })).toEqual([])
    expect(
      modelInput.inputPaths({
        ...base,
        source: 'object_storage',
        namespaceName: 'n',
        bucketName: 'b',
        objectName: 'ordinary-locator',
      })
    ).toEqual([])
  })

  it('maps resolved JSON feature arrays before dropping inactive feature controls', () => {
    const map = OciVisionBlock.tools.config?.params
    if (!map) throw new Error('Missing OCI Vision parameter mapping')
    const input = map({
      operation: 'analyze_image',
      oauthCredential: 'credential-1',
      source: 'object_storage',
      features: '["TEXT_DETECTION"]',
      language: 'ENG',
      classificationModelId: 'inactive-control-value',
      namespaceName: 'namespace',
      bucketName: 'images',
      imageObjectName: 'photo.jpg',
    })
    expect(input).toMatchObject({
      features: ['TEXT_DETECTION'],
      language: 'ENG',
      objectName: 'photo.jpg',
    })
    expect(input).not.toHaveProperty('classificationModelId')
  })
})
