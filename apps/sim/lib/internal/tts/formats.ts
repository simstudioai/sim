const AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
  linear16: 'audio/pcm',
  mulaw: 'audio/basic',
  alaw: 'audio/basic',
  ogg: 'audio/ogg',
}

const AUDIO_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  mp3: 'mp3',
  opus: 'opus',
  aac: 'aac',
  flac: 'flac',
  wav: 'wav',
  pcm: 'pcm',
  linear16: 'wav',
  mulaw: 'wav',
  alaw: 'wav',
  ogg: 'ogg',
}

export function getTtsFileExtension(format: string): string {
  return AUDIO_FILE_EXTENSIONS[format] || 'mp3'
}

export function getTtsMimeType(format: string): string {
  return AUDIO_MIME_TYPES[format] || 'audio/mpeg'
}
