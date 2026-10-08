import { motion } from 'motion/react'
import { useCallback, useState } from 'react'

import { useApi, type Dashboard as Stats, type User } from '../../api'
import { rise } from '../../motion'
import { useLiveRefresh, type Notifications } from '../../realtime'
import Loading from '../../ui/Loading'
import Tabs from '../../ui/Tabs'
import Toast from '../../ui/Toast'
import { useTab } from '../../ui/useTab'
import Carte from './Carte'
import Dashboard from './Dashboard'
import Restock from './Restock'
import Settings from './Settings'
import Team from './Team'
import './manager.css'

const TAB_IDS = ['tableau-de-bord', 'equipe', 'carte', 'reapprovisionnement', 'reglages'] as const

/** Only what calls for the manager's attention pops up; everything else goes to the live feed. */
const NOTIFICATIONS: Notifications = {
  stock_request_created: (p) => `Demande de réapprovisionnement : ${p.ingredient_name}.`,
  rupture_started: (p) => `Rupture déclarée : ${p.name}.`,
  delivery_failed: (p) => `Livraison échouée (commande n°${p.id}).`,
}

export default function ManagerSpace({ user }: { user: User }) {
  const [tab, select] = useTab(TAB_IDS)
  const [today] = useState(() => new Date())
  const stats = useApi<Stats>('dashboard')
  const { reload } = stats
  const refresh = useCallback(() => { reload() }, [reload])
  const { status, events, toast } = useLiveRefresh(refresh, NOTIFICATIONS)

  return (
    <main className="desk manager">
      <motion.header className="page-intro" variants={rise} initial="hidden" animate="show">
        <p className="eyebrow">Gérance</p>
        <h1>Bonjour {user.first_name || user.username}.</h1>
      </motion.header>

      <Tabs tabs={[
        { id: 'tableau-de-bord', label: 'Tableau de bord' },
        { id: 'equipe', label: 'Équipe' },
        { id: 'carte', label: 'Carte' },
        { id: 'reapprovisionnement', label: 'Réapprovisionnement', count: stats.data?.pending_stock_requests },
        { id: 'reglages', label: 'Tables et fournisseurs' },
      ]} current={tab} onSelect={select} label="Gérance">
        {tab === 'tableau-de-bord' && (stats.data
          ? <Dashboard stats={stats.data} today={today} status={status} events={events} />
          : <Loading failed={stats.failed} />)}
        {tab === 'equipe' && <Team />}
        {tab === 'carte' && <Carte />}
        {tab === 'reapprovisionnement' && <Restock onChange={refresh} />}
        {tab === 'reglages' && <Settings />}
      </Tabs>

      <Toast toast={toast} />
    </main>
  )
}
