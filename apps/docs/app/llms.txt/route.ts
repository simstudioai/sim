import { getLLMText } from '@/lib/llms'
import { source } from '@/lib/source'

// cached forever
export const revalidate = false

export async function GET() {
  const scan = source.getPages().map(getLLMText)
  const scanned = await Promise.all(scan)

  return new Response(scanned.join('\n\n'))
}
