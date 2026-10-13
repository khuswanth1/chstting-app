import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import NavRail from '../components/NavRail'
import Sidebar from '../components/Sidebar'
import CallOverlay from '../components/CallOverlay'
import { GroupCallOverlay } from '../components/GroupCall'
import Toasts from '../components/Toasts'

export default function AppLayout() {
  const activeChatId = useStore((s) => s.activeChatId)
  const location = useLocation()
  const isChatOpen = !!activeChatId || /^\/(chats|c)\/[^/]+$/.test(location.pathname)

  // mark the open chat as read when returning to tab
  useEffect(() => {
    const h = () => {
      const id = useStore.getState().activeChatId
      if (id && document.visibilityState === 'visible') {
        useStore.getState().markRead(id)
      }
    }
    window.addEventListener('focus', h)
    document.addEventListener('visibilitychange', h)
    return () => {
      window.removeEventListener('focus', h)
      document.removeEventListener('visibilitychange', h)
    }
  }, [])

  return (
    <div className="flex h-full overflow-hidden bg-white text-slate-800 dark:bg-wa-night dark:text-slate-100">
      <NavRail />
      <div className={`${isChatOpen ? 'hidden md:flex' : 'flex'} h-full w-full md:w-auto`}>
        <Sidebar />
      </div>
      <main className={`${isChatOpen ? 'flex' : 'hidden md:flex'} h-full min-w-0 flex-1`}>
        <Outlet />
      </main>
      <CallOverlay />
      <GroupCallOverlay />
      <Toasts />
    </div>
  )
}
