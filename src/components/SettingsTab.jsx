import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { applyTheme, useStore } from '../store'
import { desktopPermission, desktopSupported, requestDesktopPermission } from '../lib/alerts'
import { AiSettings } from './AiTools'
import BackupSection from './Backup'
import { testCallSetup } from '../lib/call'
import { Avatar, Icon, Toggle } from './ui'

function Section({ title, children }) {
  return <section className="divider px-4 py-3"><h3 className="mb-1 text-xs font-semibold uppercase text-wa-green">{title}</h3>{children}</section>
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 text-sm">{label}
      <select className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  )
}

function CallDiagnostics() {
  const [cfg, setCfg] = useState(null)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/calls/config').then(setCfg).catch(() => {}) }, [])
  async function run() {
    setBusy(true); setRes(null)
    try { setRes(await testCallSetup()) } catch (e) { setRes({ error: e.message }) } finally { setBusy(false) }
  }
  const verdict = !res ? null : res.error ? res.error
    : res.relay ? 'Relay (TURN) works: calls should connect across strict networks.'
    : res.srflx ? 'Direct connectivity works (STUN). Add TURN for strict NATs.'
    : 'Only local candidates found: calls work on this network only.'
  return (
    <div className="text-sm">
      {cfg && <p className="mb-2 text-slate-500">STUN: {cfg.stun ? 'on' : 'off'} · TURN: {cfg.turn || 'off'}{cfg.turn === 'ephemeral' ? ` (credentials expire after ${Math.round(cfg.ttl / 60)} min)` : ''} · Group calls: not supported</p>}
      {cfg?.warnings.map((w) => <p key={w} className="mb-1 rounded bg-amber-100 p-2 text-xs text-amber-900">{w}</p>)}
      <button className="btn-ghost !px-3 border border-slate-300 dark:border-slate-600" disabled={busy} onClick={run}><Icon name="phone" className="h-4 w-4" />{busy ? 'Testing…' : 'Test call setup'}</button>
      {res && <p role="status" className="mt-2">{verdict}{!res.error && <span className="block text-xs text-slate-500">host {res.host} · srflx {res.srflx} · relay {res.relay}</span>}</p>}
    </div>
  )
}

function Webhooks() {
  const { error, toast } = useStore.getState()
  const [hooks, setHooks] = useState([])
  const [events, setEvents] = useState([])
  const [url, setUrl] = useState('')
  const [sel, setSel] = useState(['message.created'])
  const [secret, setSecret] = useState(null)
  const load = () => api.get('/webhooks').then(setHooks).catch(() => {})
  useEffect(() => { load(); api.get('/webhooks/events').then(setEvents).catch(() => {}) }, [])
  async function add() {
    try { const h = await api.post('/webhooks', { url, events: sel }); setSecret(h.secret); setUrl(''); load() } catch (e) { error(e) }
  }
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">ChatFlow POSTs signed JSON (<code>X-ChatFlow-Signature: sha256=…</code>) to your URL when events happen.</p>
      {hooks.map((h) => (
        <div key={h.id} className="mb-2 flex items-center gap-2 rounded-lg bg-wa-bg p-2 text-xs dark:bg-wa-night">
          <span className="min-w-0 flex-1"><span className="block truncate font-mono">{h.url}</span><span className="text-slate-500">{h.events.join(', ')}</span></span>
          <button className="btn-ghost !px-2 !py-1" onClick={() => api.patch(`/webhooks/${h.id}`, { active: !h.active }).then(load).catch(error)}>{h.active ? 'Pause' : 'Resume'}</button>
          <button className="icon-btn h-7 w-7 text-red-500" onClick={() => api.del(`/webhooks/${h.id}`).then(load).catch(error)} aria-label="Delete webhook"><Icon name="trash" className="h-4 w-4" /></button>
        </div>))}
      {secret && <p className="mb-2 break-all rounded bg-amber-100 p-2 text-xs text-amber-900">Signing secret (shown once): <b>{secret}</b> <button className="underline" onClick={() => { navigator.clipboard?.writeText(secret); toast({ kind: 'info', title: 'Copied' }) }}>copy</button></p>}
      <input className="input mb-2" placeholder="https://example.com/chatflow-hook" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="mb-2 flex flex-wrap gap-1.5">{events.map((ev) => (
        <button key={ev} onClick={() => setSel((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]))} className={`rounded-full border px-2 py-0.5 text-xs ${sel.includes(ev) ? 'border-wa-green bg-wa-green/15' : 'border-slate-300 dark:border-slate-600'}`}>{ev}</button>))}</div>
      <button className="btn-primary" disabled={!url || !sel.length} onClick={add}>Add webhook</button>
    </div>
  )
}

export default function SettingsTab() {
  const me = useStore((s) => s.me)
  const setMe = useStore((s) => s.setMe)
  const logout = useStore((s) => s.logout)
  const { error, toast } = useStore.getState()
  const [name, setName] = useState(me.display_name)
  const [about, setAbout] = useState(me.about)
  const [phone, setPhone] = useState(me.phone || '')
  const [blocks, setBlocks] = useState([])
  const [perm, setPerm] = useState(desktopPermission())
  const fileRef = useRef()
  const s = me.settings
  const loadBlocks = () => api.get('/blocks').then(setBlocks).catch(() => {})
  useEffect(() => { loadBlocks() }, [])

  const save = async (patch) => {
    try {
      const settings = await api.patch('/settings', patch)
      setMe({ ...useStore.getState().me, settings })
      if (patch.theme) applyTheme(patch.theme)
    } catch (e) { error(e) }
  }

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <Section title="Profile">
        <div className="flex items-center gap-4 py-2">
          <button onClick={() => fileRef.current.click()} className="group relative" aria-label="Change avatar">
            <Avatar src={me.avatar_url} name={me.display_name} size={72} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100"><Icon name="camera" /></span>
          </button>
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp" onChange={async (e) => { const f = e.target.files[0]; if (!f) return; try { setMe(await api.upload('/users/me/avatar', f)) } catch (er) { error(er) } e.target.value = '' }} />
          <div className="min-w-0 flex-1"><p className="truncate text-lg font-semibold">{me.display_name}</p><p className="truncate text-sm text-slate-500">@{me.username} · {me.email}</p>
            {me.avatar_url && <button className="text-xs text-red-500" onClick={() => api.del('/users/me/avatar').then(() => setMe({ ...me, avatar_url: null })).catch(error)}>Remove photo</button>}</div>
        </div>
        <label className="mb-2 block text-xs text-slate-500">Name<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} /></label>
        <label className="mb-2 block text-xs text-slate-500">Phone number<input className="input mt-1" type="tel" placeholder="+14155550123" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} /></label>
        <label className="mb-2 block text-xs text-slate-500">About<input className="input mt-1" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} /></label>
        <button className="btn-primary" disabled={!name.trim() || (name === me.display_name && about === me.about && phone === (me.phone || ''))} onClick={async () => { try { setMe(await api.patch('/users/me', { display_name: name, about, phone })); toast({ kind: 'info', title: 'Profile saved' }) } catch (e) { error(e) } }}>Save profile</button>
      </Section>

      <Section title="Appearance">
        <Select label="Theme" value={s.theme} onChange={(theme) => save({ theme })} options={[['system', 'System default'], ['light', 'Light'], ['dark', 'Dark']]} />
      </Section>

      <Section title="Privacy">
        <Select label="Last seen & online" value={s.privacy_last_seen} onChange={(v) => save({ privacy_last_seen: v })} options={[['everyone', 'Everyone'], ['contacts', 'My contacts'], ['nobody', 'Nobody']]} />
        <Select label="Profile photo" value={s.privacy_avatar} onChange={(v) => save({ privacy_avatar: v })} options={[['everyone', 'Everyone'], ['contacts', 'My contacts'], ['nobody', 'Nobody']]} />
        <Toggle label="Read receipts" hint="If off, others won’t see blue ticks for your reads" checked={s.privacy_read_receipts} onChange={(v) => save({ privacy_read_receipts: v })} />
      </Section>

      <Section title="Notifications">
        <Toggle label="Message notifications" checked={s.notify_messages} onChange={(v) => save({ notify_messages: v })} />
        <Toggle label="Group notifications" checked={s.notify_groups} onChange={(v) => save({ notify_groups: v })} />
        <Toggle label="Sounds" checked={s.notify_sound} onChange={(v) => save({ notify_sound: v })} />
        <Toggle label="Browser notifications" hint={desktopSupported() ? `Permission: ${perm}` : 'Not supported by this browser'} checked={s.notify_desktop} onChange={async (v) => { if (v && perm === 'default') setPerm(await requestDesktopPermission()); save({ notify_desktop: v }) }} />
      </Section>

      <Section title="Blocked users">
        {!blocks.length && <p className="py-2 text-sm text-slate-500">No blocked users</p>}
        {blocks.map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-1.5"><Avatar src={u.avatar_url} name={u.display_name} size={36} /><span className="flex-1 truncate text-sm">{u.display_name}</span>
            <button className="btn-ghost !py-1" onClick={() => api.del(`/blocks/${u.id}`).then(loadBlocks).catch(error)}>Unblock</button></div>))}
      </Section>

      <Section title="AI assistant"><AiSettings /></Section>

      <Section title="Voice & video calls"><CallDiagnostics /></Section>

      <Section title="Developer webhooks"><Webhooks /></Section>

      <Section title="Backup"><BackupSection /></Section>

      <Section title="Account">
        <button className="btn-ghost w-full justify-start" onClick={logout}><Icon name="logout" className="h-4 w-4" />Log out</button>
        <button className="btn-ghost w-full justify-start text-red-500" onClick={async () => { try { await api.post('/auth/logout-all'); logout() } catch (e) { error(e) } }}><Icon name="logout" className="h-4 w-4" />Log out of all devices</button>
      </Section>
    </div>
  )
}
