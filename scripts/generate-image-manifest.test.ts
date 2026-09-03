import { describe, expect, it } from 'vitest'
import { collectImages, pairSources, renderManifest } from './generate-image-manifest'

describe('collectImages', () => {
  it('finds images across every container key a pod spec can use', () => {
    const images = collectImages([
      {
        kind: 'Deployment',
        spec: {
          template: {
            spec: {
              initContainers: [{ image: 'ghcr.io/simstudioai/migrations:v1' }],
              containers: [{ image: 'ghcr.io/simstudioai/simstudio:v1' }],
              ephemeralContainers: [{ image: 'busybox:1.36' }],
            },
          },
        },
      },
    ])

    expect(images).toEqual([
      'busybox:1.36',
      'ghcr.io/simstudioai/migrations:v1',
      'ghcr.io/simstudioai/simstudio:v1',
    ])
  })

  it('reaches containers nested below a workload wrapper', () => {
    const images = collectImages([
      {
        kind: 'CronJob',
        spec: {
          jobTemplate: {
            spec: { template: { spec: { containers: [{ image: 'curlimages/curl:8.5.0' }] } } },
          },
        },
      },
    ])

    expect(images).toEqual(['curlimages/curl:8.5.0'])
  })

  it('deduplicates the same image pulled by several workloads', () => {
    const container = { containers: [{ image: 'redis:7-alpine' }] }
    const images = collectImages([
      { spec: { template: { spec: container } } },
      { spec: { template: { spec: container } } },
    ])

    expect(images).toEqual(['redis:7-alpine'])
  })

  it('ignores an image field that is not a container image', () => {
    const images = collectImages([{ metadata: { annotations: { image: 'not-a-container' } } }])

    expect(images).toEqual([])
  })

  it('skips a container whose image is absent or empty', () => {
    const images = collectImages([
      { spec: { containers: [{ name: 'no-image' }, { image: '' }, { image: 'busybox:1.36' }] } },
    ])

    expect(images).toEqual(['busybox:1.36'])
  })

  it('tolerates null entries rather than throwing on a sparse render', () => {
    const images = collectImages([null, { spec: { containers: [null, { image: 'redis:7' }] } }])

    expect(images).toEqual(['redis:7'])
  })
})

describe('pairSources', () => {
  it('strips the sentinel registry so the mirror path is what the chart resolves to', () => {
    const paired = pairSources(
      ['ghcr.io/simstudioai/simstudio:v1', 'redis:7-alpine'],
      ['mirror.invalid/simstudioai/simstudio:v1', 'mirror.invalid/redis:7-alpine']
    )

    // ghcr.io is the default registry and is replaced, so it must not survive.
    expect(paired).toEqual([
      { source: 'ghcr.io/simstudioai/simstudio:v1', mirror: 'simstudioai/simstudio:v1' },
      { source: 'redis:7-alpine', mirror: 'redis:7-alpine' },
    ])
  })

  it('keeps a registry host that is part of the repository', () => {
    const paired = pairSources(
      ['nvcr.io/nvidia/k8s-device-plugin:v0.18.2'],
      ['mirror.invalid/nvcr.io/nvidia/k8s-device-plugin:v0.18.2']
    )

    expect(paired[0].mirror).toBe('nvcr.io/nvidia/k8s-device-plugin:v0.18.2')
  })

  it('fails rather than emitting a half-paired inventory when the renders disagree', () => {
    expect(() => pairSources(['redis:7-alpine'], [])).toThrow(/two renders disagree/)
  })
})

describe('renderManifest', () => {
  it('renders the app version and each image as a source/mirror pair', () => {
    const manifest = renderManifest({
      appVersion: 'v0.8.18',
      images: [{ source: 'ghcr.io/simstudioai/simstudio:v1', mirror: 'simstudioai/simstudio:v1' }],
    })

    expect(manifest).toContain('appVersion: v0.8.18')
    expect(manifest).toContain(
      '  - source: ghcr.io/simstudioai/simstudio:v1\n    mirror: simstudioai/simstudio:v1'
    )
  })

  it('omits the chart version so a chart-only bump does not fail the check', () => {
    const manifest = renderManifest({
      appVersion: 'v1',
      images: [{ source: 'a:1', mirror: 'a:1' }],
    })

    expect(manifest).not.toContain('chartVersion')
  })

  it('ends with a trailing newline so the checked-in file is POSIX-clean', () => {
    const manifest = renderManifest({
      appVersion: 'v1',
      images: [{ source: 'a:1', mirror: 'a:1' }],
    })

    expect(manifest.endsWith('\n')).toBe(true)
    expect(manifest.endsWith('\n\n')).toBe(false)
  })
})
