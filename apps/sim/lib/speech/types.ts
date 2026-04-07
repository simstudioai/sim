/**
 * Extensible speech-to-text provider abstraction.
 *
 * Add new providers by implementing {@link STTProvider} in `providers/`
 * and wiring them in `transcriber.ts`.
 */

export interface TranscribeOptions {
  language?: string
}

export interface TranscribeResult {
  text: string
  language?: string
}

export interface STTProvider {
  readonly name: string
  transcribe(
    audio: Buffer,
    mimeType: string,
    options?: TranscribeOptions
  ): Promise<TranscribeResult>
}
