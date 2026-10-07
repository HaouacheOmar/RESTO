import { useSearchParams } from 'react-router'

/** Current tab from `?onglet=` (so it can be linked and survives a reload), falling back to the first tab. */
export function useTab<T extends string>(ids: readonly T[]) {
  const [params, setParams] = useSearchParams()
  const current = ids.find((id) => id === params.get('onglet')) ?? ids[0]
  const select = (id: T) => setParams({ onglet: id }, { replace: true })
  return [current, select] as const
}
