export async function requestQdrant(url: string, path: string, options: RequestInit) {
  const res = await fetch(url.replace(/\/$/, '') + path, options)
  if (!res.ok) throw new Error(`Qdrant request failed: ${res.status}`)
  return res.json()
}
