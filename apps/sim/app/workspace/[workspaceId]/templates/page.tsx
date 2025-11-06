import { redirect } from 'next/navigation'

export default async function TemplatesPage() {
  // Redirect all users to the root templates page
  redirect('/templates')
}
