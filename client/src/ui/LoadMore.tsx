/** "Voir plus" under a paginated history list; renders nothing when everything is shown. */
export default function LoadMore({ hasMore, onClick }: { hasMore: boolean; onClick: () => void }) {
  return hasMore ? <button type="button" className="btn btn-link load-more" onClick={onClick}>Voir plus</button> : null
}
