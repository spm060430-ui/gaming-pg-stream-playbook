// Transient notification for order events.
import { useEffect } from 'react'
import { useAccount } from '../engine/account.jsx'

export default function Toast() {
  const { toast, dismissToast } = useAccount()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, 2600)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  if (!toast) return null
  return (
    <div className={`toast ${toast.type === 'fill' ? 'fill' : ''}`} onClick={dismissToast} key={toast.id}>
      {toast.msg}
    </div>
  )
}
