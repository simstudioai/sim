export interface AudioExtractionOptions {
  outputFormat?: 'mp3' | 'wav' | 'flac'
  sampleRate?: number
  channels?: 1 | 2
  bitrate?: string
}

export interface AudioExtractionResult {
  buffer: Buffer
  format: string
  duration: number
  size: number
}

export interface AudioMetadata {
  duration: number
  format: string
  codec?: string
  sampleRate?: number
  channels?: number
  bitrate?: number
}
