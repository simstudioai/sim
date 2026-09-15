import { describe, expect, it } from 'vitest'
import { buildUploadedFileContext } from '@/lib/mothership/chat/upload-context'

describe('uploaded file discovery guidance', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['photo.gif', 'image/gif'],
    ['report.pdf', 'application/pdf'],
    ['photo.png', 'image/png; charset=binary'],
  ])('routes supported visual %s through the agent vision command', (name, mediaType) => {
    const { content } = buildUploadedFileContext(name, mediaType, 10)

    expect(content).toContain(
      `Inspect it with sim_cli: ${JSON.stringify({ args: ['files', 'view', `uploads/${name}`] })}`
    )
    expect(content).not.toContain('files read')
    expect(content).toContain('inputs.files[].path to mount it in run_code')
    if (mediaType === 'application/pdf') expect(content).not.toContain('reference image')
  })

  it.each([
    ['notes.txt', 'text/plain'],
    ['report.md', 'text/markdown'],
    ['payroll.xlsx', 'application/octet-stream'],
  ])('retains text extraction for supported %s', (name, mediaType) => {
    const { content } = buildUploadedFileContext(name, mediaType, 10)

    expect(content).toContain(`files read "uploads/${name}"`)
    expect(content).not.toContain('files","view')
    expect(content).not.toContain('reference image')
  })

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['audio.mp3', 'audio/mpeg'],
    ['drawing.svg', 'image/svg+xml'],
    ['scan.tiff', 'image/tiff'],
    ['unknown.bin', 'application/octet-stream'],
  ])('offers a code mount without unsupported read/view instructions for %s', (name, mediaType) => {
    const { content } = buildUploadedFileContext(name, mediaType, 10)

    expect(content).toContain(`"uploads/${name}" as inputs.files[].path to mount it in run_code.`)
    expect(content).not.toContain('files read')
    expect(content).not.toContain('files","view')
    expect(content).not.toContain('reference image')
  })

  it('keeps the same encoded reference in vision and code guidance', () => {
    const { content } = buildUploadedFileContext('screen shot #1.png', 'image/png', 10)

    expect(content).toContain('"args":["files","view","uploads/screen%20shot%20%231.png"]')
    expect(content).toContain('"uploads/screen%20shot%20%231.png" as inputs.files[].path')
  })

  it('retains workflow JSON import guidance', () => {
    const { content } = buildUploadedFileContext('workflow.json', 'application/json', 10)

    expect(content).toContain('files read "uploads/workflow.json"')
    expect(content).toContain('workflows import --workflow')
  })

  it('retains archive extraction without suggesting direct reads or vision', () => {
    const { content } = buildUploadedFileContext('bundle.zip', 'application/zip', 10)

    expect(content).toContain('Archive "bundle.zip"')
    expect(content).toContain('unzip it there')
    expect(content).not.toContain('Read it with:')
    expect(content).not.toContain('Inspect it with sim_cli:')
  })
})
