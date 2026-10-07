/** Placeholder while a list loads, or the error if it could not. */
export default function Loading({ failed }: { failed: boolean }) {
  return failed
    ? <p className="form-error" role="alert">Impossible de charger ces informations. Réessayez dans un instant.</p>
    : <p className="empty" role="status">Chargement…</p>
}
