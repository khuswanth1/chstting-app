import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { applyTheme, getStoredTheme, useStore } from './store'
import Auth from './components/Auth'
import ProtectedRoute from './routes/ProtectedRoute'
import PublicRoute from './routes/PublicRoute'
import AppLayout from './routes/AppLayout'
import ChatPage from './routes/ChatPage'
import {
  CallsPlaceholder,
  ChatRedirect,
  EmptyChatPage,
  SettingsPlaceholder,
  StatusPlaceholder,
} from './routes/Placeholders'
import NotFoundPage from './routes/NotFoundPage'
import { MediaPage } from './components/Media'

export default function App() {
  const boot = useStore((s) => s.boot)
  const theme = useStore((s) => s.me?.settings.theme)

  useEffect(() => {
    boot()
  }, [boot])

  // follow the OS theme when set to "system"
  useEffect(() => {
    const effective = theme || getStoredTheme() || 'system'
    applyTheme(effective)
    if (effective !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => applyTheme('system')
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [theme])

  return (
    <Routes>
      {/* Public routes (login & register) */}
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
      </Route>

      {/* Protected application routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<EmptyChatPage />} />
          <Route path="/chats/:chatId" element={<ChatPage />} />
          <Route path="/c/:chatId" element={<ChatRedirect />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/status" element={<StatusPlaceholder />} />
          <Route path="/calls" element={<CallsPlaceholder />} />
          <Route path="/settings" element={<SettingsPlaceholder />} />
        </Route>
      </Route>

      {/* Catch-all 404 route */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

