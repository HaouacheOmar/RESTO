import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowRight, Bike, ChefHat, Clock, Crown, MapPin, Phone } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { formatPrice, useMenu, type MenuState } from '../api'
import { useAuth } from '../auth/useAuth'
import { EASE, rise, stagger } from '../motion'
import { Reveal } from '../Reveal'
import './landing.css'

const photo = (id: string, w: number) => `https://images.unsplash.com/photo-${id}?w=${w}&q=75&auto=format&fit=crop`
const IMAGES = {
  hero: '1414235077428-338989a2e8c0',
  salon: '1517248135467-4c7edcad34c4',
  chef: '1551218808-94e220e084d2',
}
const srcSet = (id: string) => [800, 1400, 2000].map((w) => `${photo(id, w)} ${w}w`).join(', ')

const dayLabel = (isoDate: string) =>
  new Intl.DateTimeFormat('fr-DZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${isoDate}T12:00`))
const YEAR = new Date().getFullYear()

const NAV = [
  { href: '#plat-du-jour', label: 'Plat du jour' },
  { href: '#carte', label: 'La Carte' },
  { href: '#salon', label: 'Salon VIP' },
  { href: '#reserver', label: 'Infos' },
]

function Header() {
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 80))
  return (
    <header className={`site-header${solid ? ' is-solid' : ''}`}>
      <div className="container header-inner">
        <a href="#top" className="logo" aria-label="RESTO, accueil">RESTO</a>
        <nav aria-label="Navigation principale">
          <ul className="nav-links">
            {NAV.map((l) => <li key={l.href}><a href={l.href}>{l.label}</a></li>)}
          </ul>
        </nav>
        <div className="header-actions">
          <AccountLink />
          <a href="#reserver" className="btn btn-gold header-cta">Réserver</a>
        </div>
      </div>
    </header>
  )
}

function AccountLink() {
  const { state } = useAuth()
  if (state.status === 'loading') return null  // session being restored: don't flash "Connexion"
  return state.status === 'authenticated'
    ? <Link to="/espace" className="header-account">Mon espace</Link>
    : <Link to="/connexion" className="header-account">Connexion</Link>
}

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '16%'])
  return (
    <section id="top" ref={ref} className="hero on-dark" aria-labelledby="hero-title">
      <motion.div className="hero-media" style={reduce ? undefined : { y }}>
        <motion.img src={photo(IMAGES.hero, 2000)} srcSet={srcSet(IMAGES.hero)} sizes="100vw" alt=""
          fetchPriority="high" initial={{ opacity: 0, transform: 'scale(1.08)' }}
          animate={{ opacity: 1, transform: 'scale(1)' }} transition={{ duration: 1.6, ease: EASE }} />
      </motion.div>
      <div className="hero-scrim" />
      <motion.div className="container hero-content" variants={stagger(0.12, 0.3)} initial="hidden" animate="show">
        <motion.p className="eyebrow ornament" variants={rise}>Cuisine algérienne contemporaine</motion.p>
        <motion.h1 id="hero-title" variants={rise}>L’art de recevoir,<br /><em>à chaque table.</em></motion.h1>
        <motion.p className="hero-lead" variants={rise}>
          Une salle feutrée, un salon VIP, le plat du jour imaginé chaque matin par notre chef,
          et la même exigence jusqu’à votre porte.
        </motion.p>
        <motion.div className="hero-actions" variants={rise}>
          <a href="#reserver" className="btn btn-gold">Réserver une table</a>
          <a href="#carte" className="btn btn-ghost-light">Découvrir la carte</a>
        </motion.div>
      </motion.div>
      <a href="#valeurs" className="scroll-cue" aria-label="Faire défiler vers la suite"><span /></a>
    </section>
  )
}

const VALUES = [
  { icon: Crown, title: 'Salon VIP', text: 'Un espace à part, réservable en ligne, pour vos dîners d’exception.' },
  { icon: ChefHat, title: 'Plat du jour', text: 'Une création différente chaque jour, servie tant qu’il y en a.' },
  { icon: Bike, title: 'Livraison', text: 'Toute la carte chez vous, suivie en temps réel jusqu’à la livraison.' },
]

function Values() {
  return (
    <section id="valeurs" className="values" aria-label="Nos engagements">
      <Reveal as="ul" className="container values-grid" each={0.12}>
        {VALUES.map(({ icon: Icon, title, text }) => (
          <motion.li key={title} variants={rise} className="value">
            <Icon aria-hidden="true" strokeWidth={1.25} size={30} />
            <h2>{title}</h2>
            <p>{text}</p>
          </motion.li>
        ))}
      </Reveal>
    </section>
  )
}

function DailySpecial({ menu }: { menu: MenuState }) {
  const special = menu.status === 'ready' ? menu.menu.plat_du_jour : null
  return (
    <section id="plat-du-jour" className="section section-cream" aria-labelledby="special-title">
      <div className="container special">
        <motion.figure className="special-media" initial={{ opacity: 0, transform: 'translateX(-32px)' }}
          whileInView={{ opacity: 1, transform: 'translateX(0px)' }} viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.9, ease: EASE }}>
          {special?.photo
            ? <img src={special.photo} alt={special.name} loading="lazy" width={1200} height={1500} />
            : <img src={photo(IMAGES.chef, 1200)} alt="Notre chef préparant le plat du jour en cuisine"
              loading="lazy" width={1200} height={1500} />}
        </motion.figure>
        <Reveal className="special-text">
          <motion.p variants={rise} className="eyebrow">Plat du jour{special && ` · ${dayLabel(special.date)}`}</motion.p>
          {menu.status === 'loading' && <motion.div variants={rise} className="skeleton" aria-hidden="true" />}
          {special && (
            <>
              <motion.h2 id="special-title" variants={rise}>{special.name}</motion.h2>
              {special.description && <motion.p variants={rise} className="special-desc">{special.description}</motion.p>}
              <motion.p variants={rise} className="special-price">{formatPrice(special.price)}</motion.p>
            </>
          )}
          {menu.status !== 'loading' && !special && (
            <motion.h2 id="special-title" variants={rise}>Le chef compose le plat du jour.</motion.h2>
          )}
          {menu.status !== 'loading' && !special && (
            <motion.p variants={rise} className="special-desc">
              Revenez un peu plus tard : il est annoncé ici dès qu’il sort de cuisine.
            </motion.p>
          )}
          <motion.div variants={rise}>
            <a href="#reserver" className="btn btn-ink">Réserver une table <ArrowRight aria-hidden="true" size={16} /></a>
          </motion.div>
        </Reveal>
      </div>
    </section>
  )
}

function Carte({ menu }: { menu: MenuState }) {
  return (
    <section id="carte" className="section section-dark on-dark" aria-labelledby="carte-title">
      <div className="container">
        <Reveal className="section-head">
          <motion.p variants={rise} className="eyebrow ornament">La Carte</motion.p>
          <motion.h2 id="carte-title" variants={rise}>Les classiques de la maison</motion.h2>
          <motion.p variants={rise}>
            Des recettes de famille, revisitées avec des produits du marché. Un plat épuisé disparaît de la carte
            jusqu’au prochain arrivage.
          </motion.p>
        </Reveal>
        {menu.status === 'error' && (
          <p className="carte-note" role="status">La carte est momentanément indisponible. Merci de réessayer dans un instant.</p>
        )}
        {menu.status === 'loading' && <p className="carte-note" role="status">Chargement de la carte…</p>}
        {menu.status === 'ready' && (
          <Reveal as="ul" className="carte-list" each={0.05}>
            {menu.menu.carte.map((dish) => (
              <motion.li key={dish.id} variants={rise} className="carte-item">
                <div className="carte-line">
                  <h3>{dish.name}</h3>
                  <span className="carte-dots" aria-hidden="true" />
                  <span className="carte-price">{formatPrice(dish.price)}</span>
                </div>
                {dish.description && <p>{dish.description}</p>}
              </motion.li>
            ))}
          </Reveal>
        )}
      </div>
    </section>
  )
}

function Salon() {
  return (
    <section id="salon" className="section" aria-labelledby="salon-title">
      <div className="container salon">
        <Reveal className="salon-text">
          <motion.p variants={rise} className="eyebrow">Salon VIP</motion.p>
          <motion.h2 id="salon-title" variants={rise}>Une soirée à part, <em>sans compromis.</em></motion.h2>
          <motion.p variants={rise}>
            Tables de quatre à huit couverts, service dédié et place de parking gardée à votre arrivée :
            indiquez simplement que vous venez en voiture lors de la réservation.
          </motion.p>
          <motion.ul variants={rise} className="salon-facts">
            <li><strong>4 à 8</strong> couverts par table</li>
            <li><strong>Voiturier</strong> sur réservation</li>
            <li><strong>Service</strong> dédié</li>
          </motion.ul>
        </Reveal>
        <motion.figure className="salon-media" initial={{ opacity: 0, transform: 'translateY(40px)' }}
          whileInView={{ opacity: 1, transform: 'translateY(0px)' }} viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1, ease: EASE }}>
          <img src={photo(IMAGES.salon, 1400)} alt="La salle du restaurant, boiseries sombres et lumière tamisée"
            loading="lazy" width={1400} height={1000} />
        </motion.figure>
      </div>
    </section>
  )
}

function Reserve() {
  return (
    <section id="reserver" className="section section-dark on-dark reserve" aria-labelledby="reserve-title">
      <Reveal className="container reserve-inner">
        <motion.p variants={rise} className="eyebrow ornament">Réservation</motion.p>
        <motion.h2 id="reserve-title" variants={rise}>Votre table vous attend.</motion.h2>
        <motion.p variants={rise} className="reserve-lead">
          Réservez en ligne depuis votre espace client : nous vous proposons la table idéale selon votre nombre de
          convives, en salle ou au salon VIP.
        </motion.p>
        <motion.div variants={rise} className="hero-actions">
          <Link to="/inscription" className="btn btn-gold">Créer mon espace client</Link>
          <a href="tel:+213550000000" className="btn btn-ghost-light"><Phone aria-hidden="true" size={16} /> 0550 00 00 00</a>
        </motion.div>
        <motion.dl variants={rise} className="infos">
          <div><dt><Clock aria-hidden="true" size={18} /> Horaires</dt><dd>Mardi – dimanche<br />12h – 15h · 19h – 23h</dd></div>
          <div><dt><MapPin aria-hidden="true" size={18} /> Adresse</dt><dd>Front de mer<br />Boumerdès, Algérie</dd></div>
          <div><dt><Bike aria-hidden="true" size={18} /> Livraison</dt><dd>Tous les jours<br />pendant le service</dd></div>
        </motion.dl>
      </Reveal>
    </section>
  )
}

function Footer() {
  return (
    <footer className="site-footer on-dark">
      <div className="container footer-inner">
        <span className="logo">RESTO</span>
        <p>© {YEAR} RESTO · Cuisine algérienne contemporaine</p>
        <Link to="/espace">Espace personnel</Link>
      </div>
    </footer>
  )
}

export default function Landing() {
  const menu = useMenu()
  return (
    <>
      <a href="#main" className="skip-link">Aller au contenu</a>
      <Header />
      <main id="main">
        <Hero />
        <Values />
        <DailySpecial menu={menu} />
        <Carte menu={menu} />
        <Salon />
        <Reserve />
      </main>
      <Footer />
    </>
  )
}
