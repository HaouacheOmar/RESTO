import { Printer, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api, formatPrice, type Ticket } from '../../api'

const stamp = new Intl.DateTimeFormat('fr-DZ', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const money = (value: string | number) => formatPrice(String(value))

/** The receipt itself: also the only thing printed (see @media print in till.css). */
function ReceiptPaper({ ticket }: { ticket: Ticket }) {
  return (
    <div className="receipt">
      <p className="receipt-brand">RESTO</p>
      <p className="receipt-center">Cuisine algérienne contemporaine<br />Front de mer, Boumerdès</p>
      <hr />
      <p className="receipt-row"><span>Addition n°{ticket.addition}</span><span>{stamp.format(new Date(ticket.date))}</span></p>
      <p className="receipt-row">
        <span>{ticket.table_number !== null ? `Table n°${ticket.table_number}` : 'Livraison'}</span>
        <span>{ticket.name}</span>
      </p>
      <hr />
      <table>
        <tbody>
          {ticket.items.map((item, i) => (
            <tr key={i}>
              <td>{item.quantity} × {item.name}</td>
              <td>{money(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <p className="receipt-row receipt-total"><span>Total</span><span>{money(ticket.total)}</span></p>
      <p className="receipt-row"><span>Payé par</span><span>{ticket.method === 'CARD' ? 'carte' : 'espèces'}</span></p>
      <hr />
      <p className="receipt-center">Merci de votre visite.<br />À très bientôt !</p>
    </div>
  )
}

/** Modal receipt for one Addition, with a print button (opened right after a payment or from the history). */
export default function ReceiptDialog({ additionId, onClose }: { additionId: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
    let current = true
    api<Ticket>('additionTicket', { id: additionId })
      .then((t) => current && setTicket(t))
      .catch(() => current && setFailed(true))
    return () => { current = false }
  }, [additionId])

  return (
    <dialog ref={dialog} className="receipt-dialog" aria-labelledby="receipt-title" onClose={onClose}>
      <div className="receipt-dialog-head">
        <h2 id="receipt-title">Ticket de caisse</h2>
        <button type="button" className="icon-button" aria-label="Fermer" onClick={() => dialog.current?.close()}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      {failed && <p className="form-error" role="alert">Ticket introuvable.</p>}
      {!ticket && !failed && <p className="muted" role="status">Préparation du ticket…</p>}
      {ticket && <ReceiptPaper ticket={ticket} />}
      <div className="card-actions">
        <button type="button" className="btn btn-ink" disabled={!ticket} onClick={() => window.print()}>
          <Printer aria-hidden="true" size={16} /> Imprimer
        </button>
        <button type="button" className="btn btn-link" onClick={() => dialog.current?.close()}>Fermer</button>
      </div>
    </dialog>
  )
}
