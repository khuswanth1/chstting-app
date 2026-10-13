import { Navigate, Outlet } from 'react-router-dom'
import { useStore } from '../store'
import { Spinner } from '../components/ui'
import Toasts from '../components/Toasts'

export default function PublicRoute() {
  const me = useStore((s) => s.me)
  const booting = useStore((s) => s.booting)

  if (booting) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-wa-night">
        <Spinner />
      </div>
    )
  }

  if (me) {
    return <Navigate to="/chats" replace />
  }

  return (
    <>
      <Outlet />
      <Toasts />
    </>
  )
}

