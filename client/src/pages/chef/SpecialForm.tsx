import { ImagePlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, toErrors, type DailySpecial, type Errors } from '../../api'

const MAX_PHOTO = 5 * 1024 * 1024

/** Create (for a fixed date or a chosen future one) or edit a Plat du jour. Sends multipart for the photo. */
export default function SpecialForm({ special, date, minDate, onSaved, onCancel }: {
  special?: DailySpecial
  /** Fixed date (today); otherwise the chef picks one, from `minDate`. */
  date?: string
  minDate?: string
  onSaved: () => void
  onCancel?: () => void
}) {
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<string | null>(special?.photo ?? null)

  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview) }, [preview])

  function pickPhoto(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_PHOTO) return setErrors({ photo: 'Photo trop lourde (5 Mo maximum).' })
    setErrors((e) => ({ ...e, photo: '' }))
    setPreview(URL.createObjectURL(file))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const photo = form.get('photo')
    if (!(photo instanceof File) || photo.size === 0) form.delete('photo')  // keep the current photo
    if (date) form.set('date', date)
    setPending(true)
    setErrors({})
    try {
      await (special
        ? api('dailySpecial', { id: special.id, method: 'PATCH', body: form })
        : api('dailySpecials', { method: 'POST', body: form }))
      onSaved()
    } catch (e) {
      const errs = toErrors(e, 'Enregistrement impossible.')
      setErrors(errs.date?.includes('unique') || errs.date?.includes('existe') ? { date: 'Un plat du jour existe déjà à cette date.' } : errs)
      setPending(false)
    }
  }

  return (
    <form className="special-form" onSubmit={submit} noValidate>
      {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      {!date && (
        <div className="field">
          <label htmlFor="sf-date">Date</label>
          <input id="sf-date" name="date" type="date" required min={minDate} defaultValue={special?.date}
            aria-invalid={errors.date ? true : undefined} aria-describedby={errors.date ? 'sf-date-error' : undefined} />
          {errors.date && <p id="sf-date-error" className="field-error">{errors.date}</p>}
        </div>
      )}
      {date && errors.date && <p className="form-error" role="alert">{errors.date}</p>}
      <div className="field">
        <label htmlFor="sf-name">Nom du plat</label>
        <input id="sf-name" name="name" required maxLength={100} defaultValue={special?.name}
          aria-invalid={errors.name ? true : undefined} />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>
      <div className="field">
        <label htmlFor="sf-description">Description</label>
        <textarea id="sf-description" name="description" rows={3} defaultValue={special?.description} />
      </div>
      <div className="field special-price">
        <label htmlFor="sf-price">Prix (DA)</label>
        <input id="sf-price" name="price" type="number" min={0} step={50} required defaultValue={special ? Number(special.price) : undefined}
          aria-invalid={errors.price ? true : undefined} />
        {errors.price && <p className="field-error">{errors.price}</p>}
      </div>
      <div className="field">
        <span className="field-label" id="sf-photo-label">Photo</span>
        <label className="photo-drop" htmlFor="sf-photo">
          {preview ? <img src={preview} alt="Aperçu de la photo du plat" /> : <><ImagePlus aria-hidden="true" size={28} strokeWidth={1.25} /> Choisir une photo</>}
        </label>
        <input id="sf-photo" name="photo" type="file" accept="image/*" className="sr-only" aria-labelledby="sf-photo-label"
          onChange={(e) => pickPhoto(e.target.files?.[0])} />
        {errors.photo && <p className="field-error" role="alert">{errors.photo}</p>}
      </div>
      <div className="card-actions">
        <button type="submit" className="btn btn-ink" disabled={pending}>
          {pending ? 'Enregistrement…' : special ? 'Enregistrer' : 'Publier le plat du jour'}
        </button>
        {onCancel && <button type="button" className="btn btn-link" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  )
}
