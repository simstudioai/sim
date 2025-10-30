import { useEffect, useMemo, useState } from 'react'

export function useForeignCredential(
  provider: string | undefined,
  credentialId: string | undefined
) {
  const [isForeign, setIsForeign] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedProvider = useMemo(() => (provider || '').toString(), [provider])
  const normalizedCredentialId = useMemo(() => credentialId || '', [credentialId])

  useEffect(() => {
    let cancelled = false
    async function check() {
      setLoading(true)
      setError(null)
      try {
        if (!normalizedCredentialId) {
          if (!cancelled) setIsForeign(false)
          return
        }
        const res = await fetch(
          `/api/auth/oauth/credentials?provider=${encodeURIComponent(normalizedProvider)}`
        )
        if (!res.ok) {
          if (!cancelled) setIsForeign(true)
          return
        }
        const data = await res.json()
        const isOwn = (data.credentials || []).some((c: any) => c.id === normalizedCredentialId)
        if (!cancelled) setIsForeign(!isOwn)
      } catch (e) {
        if (!cancelled) {
          setIsForeign(true)
          setError((e as Error).message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [normalizedProvider, normalizedCredentialId])

  return { isForeignCredential: isForeign, loading, error }
}
