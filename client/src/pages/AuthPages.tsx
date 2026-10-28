import { motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'

import { api, ApiError, toErrors, type Errors } from '../api'
import Field from '../Field'
import { homeOf } from '../auth/roles'
import { useAuth, type Registration } from '../auth/useAuth'
import { rise, stagger } from '../motion'
import './auth.css'

const PHOTO = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1400&q=75&auto=format&fit=crop'

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
  const location = useLocation()
  const from = (location.state as { from?: string; reset?: boolean } | null)?.from
  const reset = (location.state as { reset?: boolean } | null)?.reset
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
        {reset && <p className="form-success" role="status">Mot de passe modifié. Connectez-vous avec le nouveau.</p>}
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <Field label="Nom d’utilisateur" name="username" autoComplete="username" required error={errors.username} />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" required
          error={errors.password} />
        <Link to="/mot-de-passe-oublie" className="auth-forgot">Mot de passe oublié ?</Link>
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

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setErrors({})
    try {
      await api('passwordReset', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)), auth: false })
      setSent(true)
    } catch (error) {
      setErrors(toErrors(error, 'Envoi impossible pour le moment. Réessayez dans quelques minutes.'))
    }
    setPending(false)
  }

  return (
    <AuthLayout title="Mot de passe oublié" intro="Indiquez l’e-mail de votre compte : nous vous envoyons un lien pour en choisir un nouveau."
      footer={<Link to="/connexion">Retour à la connexion</Link>}>
      {sent
        ? <p className="form-success" role="status">Si un compte existe avec cette adresse, un e-mail vient de partir. Le lien est valable une heure.</p>
        : <form className="auth-form" onSubmit={submit} noValidate>
            {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
            <Field label="E-mail" name="email" type="email" autoComplete="email" required error={errors.email} />
            <button className="btn btn-ink" type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Recevoir le lien'}</button>
          </form>}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (form.get('password') !== form.get('confirm')) {
      setErrors({ confirm: 'Les deux mots de passe ne correspondent pas.' })
      return
    }
    setPending(true)
    setErrors({})
    try {
      await api('passwordResetConfirm', { method: 'POST', auth: false, body: {
        uid: params.get('uid') ?? '', token: params.get('token') ?? '', password: form.get('password') } })
      navigate('/connexion', { replace: true, state: { reset: true } })
    } catch (error) {
      const found = toErrors(error, 'Modification impossible.')
      setErrors(found.token ? { form: found.token } : found)
      setPending(false)
    }
  }

  return (
    <AuthLayout title="Nouveau mot de passe" intro="Choisissez votre nouveau mot de passe : vos autres sessions seront déconnectées."
      footer={<Link to="/mot-de-passe-oublie">Demander un nouveau lien</Link>}>
      <form className="auth-form" onSubmit={submit} noValidate>
        {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
        <Field label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required
          error={errors.password} hint="Au moins 8 caractères, pas uniquement des chiffres." />
        <Field label="Confirmer" name="confirm" type="password" autoComplete="new-password" required error={errors.confirm} />
        <button className="btn btn-ink" type="submit" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>
    </AuthLayout>
  )
}
