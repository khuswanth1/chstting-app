import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-wa-bg p-6 text-center dark:bg-wa-night">
      <div className="card max-w-md p-8 shadow-2xl space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-wa-green/10 text-wa-green">
          <Icon name="chat" className="h-8 w-8" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-wa-green">Error 404</p>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Page Not Found</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The page or conversation you are looking for does not exist or has been moved.
          </p>
        </div>
        <div className="pt-2">
          <Link to="/chats" className="btn-primary inline-flex w-full items-center justify-center gap-2">
            <Icon name="back" className="h-4 w-4" />
            <span>Back to ChatFlow</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
