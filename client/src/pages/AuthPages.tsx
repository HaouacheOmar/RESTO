import { motion } from 'motion/react'
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { ApiError } from '../api'
import { homeOf } from '../auth/roles'
import { useAuth, type Registration } from '../auth/useAuth'
import { rise, stagger } from '../motion'
import './auth.css'

const PHOTO = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1400&q=75&auto=format&fit=crop'

type Errors = Record<string, string>

/** DRF errors ({field: [messages]} or {detail}) → one message per field, `form` for the rest. */
function toErrors(error: unknown, fallback: string): Errors {
  if (!(error instanceof ApiError) || typeof error.data !== 'object' || error.data === null) {
    return { form: 'Connexion au serveur impossible. Réessayez dans un instant.' }
  }
  const errors: Errors = {}
  for (const [field, value] of Object.entries(error.data as Record<string, unknown>)) {
    const message = Array.isArray(value) ? value.join(' ') : String(value)
    errors[field === 'detail' || field === 'non_field_errors' ? 'form' : field] = message
  }
  return Object.keys(errors).length ? errors : { form: fallback }
}

function Field({ label, name, error, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & {
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

function AuthLayout({ title, intro, children, footer }: {
  title: string; intro: string; children: ReactNode; footer: ReactNode
}) {
  return (
    <div className="auth">
      <aside className="auth-visual on-dark" aria-hidden="true">
        <img src={PHOTO} alt="" />
        <div className="auth-visual-text">
          <Link to="/" className="logo" tabIndex={-1}>RESTO</Link>
          <p>« L’art de recevoir, à chaque table. »</p>
        </div>
      </aside>
      <main className="auth-panel">
        <Link to="/" className="auth-back">← Retour au site</Link>
        <motion.div className="auth-card" variants={stagger(0.08, 0.1)} initial="hidden" animate="show">
          <motion.p variants={rise} className="eyebrow">RESTO</motion.p>
          <motion.h1 variants={rise}>{title}</motion.h1>
          <motion.p variants={rise} className="auth-intro">{intro}</motion.p>
          <motion.div variants={rise}>{children}</motion.div>
          <motion.p variants={rise} className="auth-switch">{footer}</motion.p>
        </motion.div>
      </main>
    </div>
  )
}

export function LoginPage() {
  const { state, login } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  if (state.status === 'authenticated') return <Navigate to={from ?? homeOf(state.user)} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setErrors({})
    try {
      const user = await login(String(form.get('username')), String(form.get('password')))
      navigate(from ?? homeOf(user), { replace: true })
    } catch (error) {
      setErrors(error instanceof ApiError && error.status === 401
        ? { form: 'Nom d’utilisateur ou mot de passe incorrect.' }
        : toErrors(error, 'Connexion impossible.'))
      setPending(false)
    }
  }

  return (
    <AuthLayout title="Connexion" intro="Clients et équipe du restaurant : un seul accès, chacun son espace."
      footer={<>Pas encore de compte ? <Link to="/inscription">Créer mon espace client</Link></>}>
      <form className="auth-form" onSubmit={submit} noValidate>
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <Field label="Nom d’utilisateur" name="username" autoComplete="username" required error={errors.username} />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" required
          error={errors.password} />
        <button className="btn btn-ink" type="submit" disabled={pending}>{pending ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { state, register } = useAuth()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  if (state.status === 'authenticated') return <Navigate to={homeOf(state.user)} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget)) as unknown as Registration
    setPending(true)
    setErrors({})
    try {
      const user = await register(data)
      navigate(homeOf(user), { replace: true })
    } catch (error) {
      setErrors(toErrors(error, 'Inscription impossible.'))
      setPending(false)
    }
  }

  return (
    <AuthLayout title="Créer mon espace" intro="Réservez une table, commandez en livraison et retrouvez vos additions."
      footer={<>Déjà un compte ? <Link to="/connexion">Se connecter</Link></>}>
      <form className="auth-form" onSubmit={submit} noValidate>
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <div className="field-row">
          <Field label="Prénom" name="first_name" autoComplete="given-name" error={errors.first_name} />
          <Field label="Nom" name="last_name" autoComplete="family-name" error={errors.last_name} />
        </div>
        <Field label="Nom d’utilisateur" name="username" autoComplete="username" required error={errors.username} />
        <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field label="Téléphone" name="phone" type="tel" autoComplete="tel" error={errors.phone}
          hint="Facultatif, pour vous joindre à propos d’une réservation ou d’une livraison." />
        <Field label="Mot de passe" name="password" type="password" autoComplete="new-password" required
          error={errors.password} hint="Au moins 8 caractères, pas uniquement des chiffres." />
        <button className="btn btn-ink" type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer mon espace'}</button>
      </form>
    </AuthLayout>
  )
}
