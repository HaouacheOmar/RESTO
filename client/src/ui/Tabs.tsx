import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface Tab<T extends string> {
  id: T
  label: string
  /** Shown as a small counter next to the label (e.g. reservations waiting). */
  count?: number
}

/** Accessible tablist (arrow keys move between tabs). Pair with `useTab` to keep the tab in the URL. */
export default function Tabs<T extends string>({ tabs, current, onSelect, label, children }: {
  tabs: readonly Tab<T>[]
  current: T
  onSelect: (id: T) => void
  label: string
  children: ReactNode
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})

  function onKey(event: KeyboardEvent) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    const index = tabs.findIndex((t) => t.id === current)
    const next = tabs[(index + delta + tabs.length) % tabs.length].id
    onSelect(next)
    refs.current[next]?.focus()
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el }} type="button" role="tab" id={`tab-${t.id}`}
            aria-selected={current === t.id} aria-controls="tab-panel" tabIndex={current === t.id ? 0 : -1}
            className={current === t.id ? 'is-active' : ''} onClick={() => onSelect(t.id)}>
            {t.label}
            {t.count ? <span className="tab-count" aria-label={`(${t.count})`}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      <section id="tab-panel" role="tabpanel" aria-labelledby={`tab-${current}`} className="tab-panel">
        {children}
      </section>
    </>
  )
}
