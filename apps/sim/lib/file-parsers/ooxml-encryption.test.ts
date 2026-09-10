/**
 * @vitest-environment node
 *
 * The fixtures are real password-protected packages (`msoffcrypto-tool -e -p x`)
 * around one-part OOXML documents, gzipped because an OLE container is mostly
 * zero-padded sectors.
 */
import { gunzipSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { parseBuffer } from '@/lib/file-parsers'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import type { FileParserError } from '@/lib/file-parsers/errors'
import { isEncryptedOoxmlContainer } from '@/lib/file-parsers/ooxml-encryption'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'
import { sniffFileKind } from '@/lib/file-parsers/sniff'

const ENCRYPTED_DOCX_GZ_BASE64 =
  'H4sIAGMbomoC/+1X63LaRhRe3xLbvSVpm6Zummj01xMLMObiARKu5maDhbEx/2RpkRTQxbpEiE6foi/QPELfov/aF+hM+7vP0LhHQtjgS4qcdCbtcDSfVrur3W/POd+u4Ndf7v/++qe1P9AlS6EF9OZsBd0Za5sDzI8q94Z1B2/Ozs5GzWcz+0/ZXwAnfwuQu0Uvl07O7wKWvfqqV87s/2ej/bvglTfl/yPAx4BPAJ8CPhseAeg+4AHgc8AXgC8BDwFfAR4BvgasAb4BPAZ8C3gCeDrT1AdhNFLgMhCB8kiGUkM28mMP0dL5mb96wzs/2g/+/OHFb3Ojcgl54gJzWFmXVQV2jDhURwy0dOHOQ/2fjIQv0rg/0/CvQFt/Ydh3B+WAyQA0YAUOM0a6D/8fwRdwxL04pf/jfYfApwGjCFmQkX+7h+bn/PrvtFW9vqve70KpTs2/BvxOKJe8b/80/M5vCPVG/hLEoQPRmM4eoznX/7tuLv3Hv+Fq3ok9f0mLw4xcXd+khW8Rf0cnL7y+A+BjgEd3fdaQ5N//c/0t/wv+X13fZf/nzv1fuQX/HdjvGnBJwOL37EHut8d//B2t/oyuO3+GPvvJwBPgn/d+B/s5f14voQ/CEoBd8Jt1VaADOhCHDZR1I+EoX4TSOaM2rj0pR/8B5m7Jv+yNFcbmIKb4LoTew94d5w/dci+0vPHOefodKsAVR2m0CWUA7s/QForAXAV4CsNT0G3LwMpy0OP0pqE9CNEOQksARWEdznvfoz0feZl2rTflavEd9LMIl3OWJZ73pR7xCmu6qMhJMrgRIAksswonynySbB4UnsVIQjcYmWN6ioyTpI118nlqNQEvabZqwCgCZpD1JCkYhrpNUTorYInRNySR1RRd6RgbrCJRSqcjspgKBQIR6mIoORy7rfoY3cV2fjiBolEqo+uWonGjidjbTsRizRChjzEwmVolwBLQn2MMhtCZntEQB+B7MEISJz2F7V5U4aWMaID3oS2oCYwuDPsiYdKd5dxYURWwlu7xiiYagpQk0/kG6bVmBUaU3YCPnnYVDmcz2eGMY4MaxfRWMES6azpkeiYw9evHUSG9X9zP6cKu3js17biC08kkSVCeIxx4UZINzMMkNuFFH3NFiWEr2E6SxWgsf1DPqSzuW6H+oFnmKdEIxwKDer1ktdgdmdcq3BFHxy1VKUU4I9Irx5l4tlqy6L7J0KHc3qaYwWyb1UIvsW2Ke9qOUNl3VjDB5a23aR0Lxa1ov2oclYPF9awmMdncAOe79dO+1amp5iFt4oJcpLSc0I20u9FCPNe0ZKrNS3y0dsjHalUr3WkJUUHTapkc38Lilm2N+zueWD11noaJdsLUxHcWXWoixQl1+9xfiCuhq6KcVUzZAKUEHCN9SGlSPJdsQmbvV1lv5R1TXeVVfJ895JVqNdI41Te5cuV0L25N5PwQa7CjsFYEopKsmhCHk82yWR1kep0GHexTgRa9b9NBR6tvpb12Rm8dgz62jmjVzq9LMTrSs/mDWn2Qjm1WqMpuiellysVolRustyOiKOUbZkBqxfXjTLDHtw/SdBi3mu2XSss6CbHtaqbF8SdH+YPs8aR2IZcj6Z6adSUv7uGddT5Xa/ZZaT1c4HE/TDeOG5VOM23Uwqp8agYK7IUcXWlMCMiTKXVJp4mxgzG1imY2s5nN7Hr7GzWns/kAGAAA'

const ENCRYPTED_PPTX_GZ_BASE64 =
  'H4sIAGMbomoC/+1X6XLaRhxffCS2ezk90tRNE436kYnFfXgMCWc5jY1ijPkmJCHJQgeSDIhOn6JPkEfoW/Rb+wKdaT/3GRr3LyEw+EiRk86kHX6an1a7q93f/o9dwa+/PPj91U87f6ArSKJV9PpiE92bafMAVyaV7XHd4uuLi4tJ88US/yn8BbTitwqxW3NiacX8PnDDqW855RL/P0z276pT3hb/D4AfAj8Cfgz8ZHwEoAfAT4GfAT8HfgF8CPwS+Aj4FXAH+DXwMfAb4BPg02VOvReoIwUuA2Eoh2QoNWQiN3iI1qdn/tYt72yb3/7544vfPJNyHTnJBbBUaVtVBXUWMegQUdAiwp2D+j8Bhy/SrD2L6G9CW3N13HcPZUHJAJKwAkuZRboL+x/BF3Civbag/bN9DdDTQFGAKMjIPbbRiset/VZbxem7bn0VSnVh/R3Qt1y57nz7F9G3fkOot+oXwQ8d8MZieIw8tv337Vi69z9p57zle+5KLo4jcn198wjdwf9Wnrxw+l6CHgU6um2zhiT39k/zb+NfsP/6+q7a75nav3kH/Xuw3zXQkkDF7dmD7G+Pe/9bufozuun8GdvsJgJPQH/F+R3s5vx5tY7eC+wDq2A3bWeBDuyAH3ZRxvaElfkClNYZtXvjSTn5D+C5o/6GM5afmQNb4LsQeAd7d1Y/cMe90HTGW+fp9ygPVxylUBBKH9yfoTCKwFx5eArBk99uS8PKstBj9aag3Q/e9kOLD0VhHdZ7P6ADF3FZdK23xWrtLfJnDS7rLNt/PpS6WJ/VdEGRE7h/14djrEwrjCBzCfz4Zf5ZDMd0g5IZqqvIbAI3WR1/ntzah5c0UzVgFAYzyHoC5w1D3SMIneZZidJ3JYHWFF3pGLu0IhFKpyPQLBHw+SLE5VB8PHZPdTFaZM3ceAJFI1RK1weKxkwmou86Ec1qhgB9lMHiyS0MsA/9WcqgMJ3qGqQwAtv9ERxrdxVavKzCS2nBAOsDYajxlM6P+yIh3J5lClpQeVZLdTlFEwxeSuCpHIk7rRmeEmTb4ZOnqsKwmXRmPOPMILKQCvsDuL2mBtU9ByWjUeo3Cp1ooXQSPTgQK4ejQqZ+lEjgGOEYwoAVRdlgOZjExBzvs0xBougyayZwbzx1RjPUSY3zBYM9PlApZWOh7qE3HY360t5cLO7jQsHsca0qNc9CEZMvyrUo02kRXKffaqfj1GnmSM61BrWIVulUvyNz/kM9yA6sFcxpOeuNnxLkcEie5Ml2RSI4pVxmcrKXPxO9ZpiRWnwuJvfystDS2iO5e3zaaxV5PdALV7zhiJQelmIcdWiGQhSXP2YDjJFXqrU6FeNm7Z0NrJ6chmGuHTvXhLdOuuRciPfVvam94FdMVwU5o5zLBmSKzwLuIpXmk+cK5tLs3WbWG3Vnsm7YIVizTFVSPjJrjkLZaLvX0eZj3mA12FGsVgChoqyegx/C2rEharnqSZnyM1xcUgVCVKzYvVH2xhmddbRK/WGkeMCHRyLfF1PRFKlJDNlUKKGYZcXwmdlrZKrNYIb3tc979WqgXsvmvWJTHXTVYbd9FB4OhFCdSRdSLGmWut6mqJn1wbwdEEtHrJqmg8qo1OWH3pxeSkfNdinOHx0V6+1+q1hnBlwtTmVTfrUcyl2mo50acwnkpClxJU/3Zw7G5BZaYokllrgZfwOgB9C8ABgAAA=='

const ENCRYPTED_XLSX_GZ_BASE64 =
  'H4sIAGMbomoC/+1X23LaRhhefIrtnpIe0tRNE41umRgJCWw8QILBnAzEgG0OVxWSEDLoYEkc5E6fok+Q6171LXrXvkBn2us+Q+P+EgIDtlPkpDNph0/zabW72v32P+wKfv3lwe+vftr6A80gipbR68sNtDbR5gEujSr3h3WLry8vL0fNlwv8p/AX0IrfMsRuxYmlFfN7wHWnvumUC/z/MNq/y055W/w/AH4I/Aj4MfCT4RGAHgA/BX4G/Bz4BfAh8EvgI+BXwC3g18DHwG+AT4BPFzn1XqCEFLgMhKEDJEOpIRO5wUO0Oj7zN29559sf6T9/ePGbZ1SuIie5AJYqa6uqoM4jDh0hBlracBeg/k/A4Ys0ac88+hvQ1loe9q2hBCgZwDKswFLmke7C/kfwBRxpr8xp/2TfKehpoChCFGTkHvfRkset/VZbzum7bn0eSnVu/S3Qt1y56nz759G3fkOot+pnwA9N8MZ8eIw8tv337Fi693/ZznnL98JMLg4jcn1906Dv4H8rT144fcegx4CObtusIcm9/eP8W/8X7L++vln7PWP7N+6gvwb7XQMtCVTcnj3I/va497+Vqz+jm86foc1uIvAE9Jec38Fuzp9Xq+i9QBiYB7tZOwt0YBP8sI3itieszBehtM6o7RtPytF/AM8d9dedsa2JObA5vgv+d7B3J/X9d9wLVWe8dZ5+h5JwhVAMUVAScH+GAigIcyXhiYYn0m7bh5UloMfqjUE7Cd4moYVAO7AO673vUcFFXOZd622xWnmL/FmByzrLws8HUgfr8ZouKnIEJ7cJHONlVuFEWYjgJ8fJZ7s4phuMzDEdReYjuMnr+PPoZhhe0kzVgFEYzCDrEbxlGOqez6ezLV5i9G1JZDVFV5rGNqtIPqXZFFne5yeIoO9qKD4cu6e6GN3mzYPhBIrmUxld7ysaN5qIvetELK8ZIvQxBo9HNzFAGPoTjMFgOtMxyuIF2E4GcazRUdj2VRVe2hcNsN4fgFqL0VvDviCN27OMwYpqi9diHUHRRKMlRfDYQRl3WuMtRpRth4+e8grHx/fjwxknBpXTsQDpx+01nTKdLih1iXqZERLJE38zxWZ9sTQZSGdjkQiO+RxDOLAiIxu8AJOYmON9nktLDHvImxF8IB0mzmXqqKt0S4F+vjI4alF580xkBIol6WRaEQoFqqYM9IZWkrK1smBktYNeRS3opXQzWaOzfvqEDcgDLlZTy0HVVEK5RNJewZSWs15/lUjlKFOudWOH+XSlKbFBszrIky9DNZo8ZXcprtI2qVyPyqd8fJIpqWklM9gNlU6Pq+f16lmoGSQ5PUWalNCj+tn9Klelgrwwae9kYPXoOAxT7VhXE9866aJTIQ6re2N7wa+YropyXOnKBmQKYQF3kUrTyTODqTR7t5n1Rt2JrIuTOiOfFQ+93X4iY3rVVrt77i9OxfyU12BH8VoahDKy2gU/BAe9UL5c7JB1gZbriXLD8BOVPox6o+yNMzrrOJa8TIM76hTLR8FkQz3TG72LC4LY0RS2QPaEtlyrZHr1XIYOFnckb7+XrZdyXqbXqpybHC0JHbNYuTgv6EVCziuZY0n0Vnf7M3ZALB0xOtXoGUFvl31Z3U0N2HIgbtRZPRWva2d8P1Vp1NtmWuIpuqPQV+lop8ZUAjlp6pvJ0/DEwRjdRAsssMACN+NvkOlqlgAYAAA='

const decode = (gzBase64: string): Buffer => gunzipSync(Buffer.from(gzBase64, 'base64'))
const encryptedDocx = decode(ENCRYPTED_DOCX_GZ_BASE64)
const encryptedPptx = decode(ENCRYPTED_PPTX_GZ_BASE64)
const encryptedXlsx = decode(ENCRYPTED_XLSX_GZ_BASE64)

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

describe('isEncryptedOoxmlContainer', () => {
  it('recognizes encrypted Word, PowerPoint, and Excel packages', () => {
    expect(isEncryptedOoxmlContainer(encryptedDocx)).toBe(true)
    expect(isEncryptedOoxmlContainer(encryptedPptx)).toBe(true)
    expect(isEncryptedOoxmlContainer(encryptedXlsx)).toBe(true)
  })

  it('does not flag a plain OLE container or a non-OLE buffer', () => {
    expect(isEncryptedOoxmlContainer(Buffer.concat([OLE2_MAGIC, Buffer.alloc(4096)]))).toBe(false)
    expect(
      isEncryptedOoxmlContainer(
        Buffer.concat([Buffer.from('PK'), Buffer.from('EncryptedPackage', 'utf16le')])
      )
    ).toBe(false)
  })

  it('requires both streams in the directory', () => {
    const onlyPackage = Buffer.concat([
      OLE2_MAGIC,
      Buffer.alloc(512),
      Buffer.from('EncryptedPackage', 'utf16le'),
    ])
    expect(isEncryptedOoxmlContainer(onlyPackage)).toBe(false)
  })
})

describe('encrypted package routing', () => {
  it('sniffs an encrypted package as its own kind', () => {
    expect(sniffFileKind(encryptedPptx)).toBe('encrypted-ooxml')
    expect(sniffFileKind(Buffer.concat([OLE2_MAGIC, Buffer.alloc(4096)]))).toBe('ole2')
  })

  it.each([
    ['docx', encryptedDocx],
    ['pptx', encryptedPptx],
    ['xlsx', encryptedXlsx],
    ['doc', encryptedDocx],
  ])('rejects an encrypted package labelled .%s as encrypted_file', async (extension, buffer) => {
    await expect(parseBuffer(buffer, extension)).rejects.toMatchObject<FileParserError>({
      code: 'encrypted_file',
    })
  })

  it('classifies an encrypted deck before the legacy .ppt rejection', async () => {
    await expect(
      new PptxParser().parseBuffer(encryptedPptx)
    ).rejects.toMatchObject<FileParserError>({ code: 'encrypted_file' })
  })

  it('classifies an encrypted document before the plaintext fallback', async () => {
    const error = await new DocxParser()
      .parseBuffer(encryptedDocx)
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'encrypted_file' })
  })
})
