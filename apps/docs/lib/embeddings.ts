/**
 * Generate embeddings for search queries using OpenAI API
 */
export async function generateSearchEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required')
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: query,
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const data = await response.json()

  if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('OpenAI API returned invalid response structure: missing or empty data array')
  }

  if (!data.data[0]?.embedding || !Array.isArray(data.data[0].embedding)) {
    throw new Error('OpenAI API returned invalid response structure: missing or invalid embedding')
  }

  return data.data[0].embedding
}
