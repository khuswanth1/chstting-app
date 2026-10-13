import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { ChatLockGate } from '../components/ChatLock'
import ChatWindow from '../components/ChatWindow'

export default function ChatPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const activeChatId = useStore((s) => s.activeChatId)
  const openChat = useStore((s) => s.openChat)
  const chats = useStore((s) => s.chats)

  // parse chatId to number if numeric, otherwise preserve string (e.g. UUIDs or IDs)
  const parsedId = /^\d+$/.test(chatId) ? Number(chatId) : chatId

  useEffect(() => {
    if (parsedId != null && String(activeChatId) !== String(parsedId)) {
      openChat(parsedId)
      if (!chats[parsedId]) {
        useStore.getState().refreshChat(parsedId)
      }
    }
  }, [parsedId, activeChatId, openChat, chats])

  const handleBack = () => {
    useStore.getState().openChat(null)
    navigate('/chats')
  }

  return (
    <ChatLockGate chatId={parsedId}>
      <ChatWindow
        key={parsedId}
        chatId={parsedId}
        onBack={handleBack}
      />
    </ChatLockGate>
  )
}
