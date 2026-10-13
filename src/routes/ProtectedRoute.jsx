import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import { Spinner } from '../components/ui'

export default function ProtectedRoute() {
  const me = useStore((s) => s.me)
  const booting = useStore((s) => s.booting)
  const location = useLocation()

  if (booting) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-wa-night">
        <Spinner />
      </div>
    )
  }

  if (!me) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
