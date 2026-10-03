declare module 'word-extractor' {
  interface WordTextOptions {
    /** Converts common Unicode quotes to ASCII when true (the library default). */
    filterUnicode?: boolean
  }

  interface WordHeaderOptions extends WordTextOptions {
    includeFooters?: boolean
  }

  interface WordTextboxOptions extends WordTextOptions {
    includeHeadersAndFooters?: boolean
    includeBody?: boolean
  }

  class WordDocument {
    getBody(options?: WordTextOptions): string
    getFootnotes(options?: WordTextOptions): string
    getEndnotes(options?: WordTextOptions): string
    getHeaders(options?: WordHeaderOptions): string
    getFooters(options?: WordTextOptions): string
    getAnnotations(options?: WordTextOptions): string
    getTextboxes(options?: WordTextboxOptions): string
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>
  }

  export = WordExtractor
}
