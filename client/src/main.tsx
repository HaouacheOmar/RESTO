import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'  // first: shared tokens and blocks, so page styles can refine them
import App from './App'

// Error tracking only when a DSN is configured; loaded as a separate chunk so it costs nothing otherwise.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  import('@sentry/browser').then((Sentry) => Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE }))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Honour the OS "reduce motion" setting: transforms are skipped, fades kept. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
