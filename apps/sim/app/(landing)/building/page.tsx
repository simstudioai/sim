import { redirect } from 'next/navigation'

/**
 * Redirects /building to the latest blog post
 */
export default function BuildingPage() {
  redirect('/building/openai-vs-n8n-vs-sim')
}
