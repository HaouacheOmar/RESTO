import { useState, type FormEvent } from 'react'

import { api, errorText, formatPrice, toErrors, useApi, type CarteDish, type Errors, type Ingredient } from '../../api'
import Loading from '../../ui/Loading'

/** Create or edit a Carte dish with its Recette (ingredients). Multipart so a photo can be attached. */
function DishForm({ dish, ingredients, onSaved, onCancel }: {
  dish?: CarteDish; ingredients: Ingredient[]; onSaved: () => void; onCancel: () => void
}) {
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const photo = form.get('photo')
    const hasPhoto = photo instanceof File && photo.size > 0
    // JSON unless there is a photo: multipart cannot express an empty Recette (`ingredients: []`).
    const body = hasPhoto ? form : {
      name: form.get('name'), price: form.get('price'), description: form.get('description'),
      ingredients: form.getAll('ingredients').map(Number),
    }
    setPending(true)
    setErrors({})
    try {
      const saved = await (dish ? api<CarteDish>('dish', { id: dish.id, method: 'PATCH', body }) : api<CarteDish>('dishes', { method: 'POST', body }))
      if (hasPhoto && !form.has('ingredients')) {
        await api('dish', { id: saved.id, method: 'PATCH', body: { ingredients: [] } })
      }
      onSaved()
    } catch (e) {
      setErrors(toErrors(e, 'Enregistrement impossible.'))
      setPending(false)
    }
  }

  return (
    <form className="admin-form" onSubmit={submit} noValidate>
      {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
      <div className="field-row">
        <div className="field">
          <label htmlFor="dish-name">Nom</label>
          <input id="dish-name" name="name" required defaultValue={dish?.name} aria-invalid={errors.name ? true : undefined} />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>
        <div className="field">
          <label htmlFor="dish-price">Prix (DA)</label>
          <input id="dish-price" name="price" type="number" min={0} step={50} required defaultValue={dish ? Number(dish.price) : undefined}
            aria-invalid={errors.price ? true : undefined} />
          {errors.price && <p className="field-error">{errors.price}</p>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="dish-description">Description</label>
        <textarea id="dish-description" name="description" rows={2} defaultValue={dish?.description} />
      </div>
      <fieldset className="recipe">
        <legend>Recette <span className="muted">(un ingrédient en rupture rend le plat indisponible)</span></legend>
        {ingredients.map((i) => (
          <label key={i.id} className="check">
            <input type="checkbox" name="ingredients" value={i.id} defaultChecked={dish?.ingredients.includes(i.id)} />
            {i.name}{i.is_out_of_stock && <span className="badge is-cancelled">rupture</span>}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="dish-photo">Photo (facultatif)</label>
        <input id="dish-photo" name="photo" type="file" accept="image/*" />
      </div>
      <div className="card-actions">
        <button type="submit" className="btn btn-ink btn-small" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer'}</button>
        <button type="button" className="btn btn-link" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  )
}

export default function Carte() {
  const dishes = useApi<CarteDish[]>('dishes')
  const ingredients = useApi<Ingredient[]>('ingredients')
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [error, setError] = useState('')
  const names = new Map((ingredients.data ?? []).map((i) => [i.id, i.name]))

  async function patch(dish: CarteDish, body: object) {
    setError('')
    try {
      await api('dish', { id: dish.id, method: 'PATCH', body })
      dishes.reload()
    } catch (e) {
      setError(errorText(e, 'Action impossible.'))
    }
  }

  async function remove(dish: CarteDish) {
    setError('')
    try {
      await api('dish', { id: dish.id, method: 'DELETE' })
      dishes.reload()
    } catch (e) {
      setError(errorText(e, 'Suppression impossible.'))
    }
  }

  if (!dishes.data || !ingredients.data) return <Loading failed={dishes.failed || ingredients.failed} />
  const saved = () => { setEditing(null); dishes.reload() }

  return (
    <section aria-labelledby="carte-title">
      <div className="section-bar">
        <h2 id="carte-title" className="desk-section-title">La Carte</h2>
        <button type="button" className="btn btn-ink btn-small" onClick={() => setEditing('new')}>Nouveau plat</button>
      </div>
      {editing === 'new' && <DishForm ingredients={ingredients.data} onSaved={saved} onCancel={() => setEditing(null)} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <ul className="card-list">
        {dishes.data.map((d) => (
          <li key={d.id} className="card">
            {editing === d.id ? <DishForm dish={d} ingredients={ingredients.data!} onSaved={saved} onCancel={() => setEditing(null)} /> : (
              <>
                <div className="card-head">
                  <h3>{d.name}</h3>
                  <span className={`badge ${d.is_orderable ? 'is-confirmed' : 'is-cancelled'}`}>
                    {d.is_orderable ? 'Disponible' : d.is_available ? 'Indisponible (rupture)' : 'Retiré de la carte'}
                  </span>
                </div>
                <p className="muted">{formatPrice(d.price)}{d.description && ` · ${d.description}`}</p>
                <p className="recipe-chips">{d.ingredients.length
                  ? d.ingredients.map((i) => <span key={i} className="chip">{names.get(i)}</span>)
                  : <span className="muted">Pas de recette</span>}</p>
                <div className="card-actions">
                  <button type="button" className="btn btn-link" onClick={() => setEditing(d.id)}>Modifier</button>
                  <button type="button" className="btn btn-link" onClick={() => patch(d, { is_available: !d.is_available })}>
                    {d.is_available ? 'Retirer de la carte' : 'Remettre à la carte'}
                  </button>
                  <button type="button" className="btn btn-link" onClick={() => remove(d)}>Supprimer</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
