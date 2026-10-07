import { useId, type InputHTMLAttributes } from 'react'

export default function Field({ label, name, error, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; name: string; error?: string; hint?: string
}) {
  const id = useId()
  const described = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={described} {...input} />
      {hint && !error && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  )
}
