import { describe, expect, it } from 'vitest'
import { extractOcrImageFiles } from '@/lib/internal/mistral/images'
import { MAX_OCR_EXTRACTED_IMAGES } from '@/tools/mistral/types'

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('synthetic jpeg body')])
const dataUri = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString('base64')}`

function image(id: string, imageBase64: string | undefined) {
  return {
    id,
    top_left_x: 0,
    top_left_y: 0,
    bottom_right_x: 10,
    bottom_right_y: 10,
    image_base64: imageBase64,
  }
}

describe('extractOcrImageFiles', () => {
  it('moves image bytes into files named as storage will name them, with no base64 left in the page output', () => {
    const { output, files } = extractOcrImageFiles({
      pages: [
        {
          index: 2,
          markdown: '![img-0.jpeg](img-0.jpeg)',
          images: [image('img-0.jpeg', dataUri(JPEG))],
        },
      ],
    })
    expect(files).toEqual([{ buffer: JPEG, name: 'page-2-img-0.jpg', mimeType: 'image/jpeg' }])
    expect(JSON.stringify(output)).not.toContain(JPEG.toString('base64'))
    expect(output.pages).toEqual([
      expect.objectContaining({
        images: [expect.objectContaining({ id: 'img-0.jpeg', file_name: 'page-2-img-0.jpg' })],
      }),
    ])
  })

  it('stores at most the image cap and keeps the bounding boxes of the rest without a file', () => {
    const images = Array.from({ length: MAX_OCR_EXTRACTED_IMAGES + 1 }, (_, i) =>
      image(`img-${i}.jpeg`, JPEG.toString('base64'))
    )
    const { output, files } = extractOcrImageFiles({ pages: [{ index: 0, images }] })
    expect(files).toHaveLength(MAX_OCR_EXTRACTED_IMAGES)
    const pageImages = (output.pages as Array<{ images: Array<Record<string, unknown>> }>)[0].images
    expect(pageImages).toHaveLength(MAX_OCR_EXTRACTED_IMAGES + 1)
    expect(pageImages.at(-1)).not.toHaveProperty('file_name')
    expect(pageImages.at(-1)).not.toHaveProperty('image_base64')
  })

  it('skips an image over the per-image cap instead of failing the parse', () => {
    const huge = Buffer.alloc(21 * 1024 * 1024)
    const { output, files } = extractOcrImageFiles({
      pages: [
        {
          index: 0,
          images: [image('img-0.png', dataUri(huge)), image('img-1.jpg', dataUri(JPEG))],
        },
      ],
    })
    expect(files.map((file) => file.name)).toEqual(['page-0-img-1.jpg'])
    expect(JSON.stringify(output)).not.toContain('image_base64')
  })
})
