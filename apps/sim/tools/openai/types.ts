export interface BaseImageRequestBody {
  model: string
  prompt: string
  size: string
  n: number
  [key: string]: unknown
}
