/**
 * `heic-decode` ships no types. Only the surface we use is declared: `all()`
 * reports each image's declared dimensions and defers the decode, which is what
 * lets a caller refuse an oversized one before any raster is allocated.
 */
declare module 'heic-decode' {
  interface DecodedHeifImage {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  interface HeifImageHandle {
    width: number
    height: number
    decode: () => Promise<DecodedHeifImage>
  }

  /**
   * `dispose` is non-enumerable on the returned array and is NOT optional: it frees
   * the image handles and the libheif context, which `all()` — unlike the default
   * export — leaves to the caller. Declared required so a caller cannot forget it.
   */
  interface HeifImageHandles extends Array<HeifImageHandle> {
    dispose: () => void
  }

  function decode(options: { buffer: Buffer }): Promise<DecodedHeifImage>

  namespace decode {
    function all(options: { buffer: Buffer }): Promise<HeifImageHandles>
  }

  export = decode
}
