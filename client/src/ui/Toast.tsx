import { AnimatePresence, motion } from 'motion/react'

/** One notification at a time, announced politely to screen readers. */
export default function Toast({ toast }: { toast: { id: number; text: string } | null }) {
  return (
    <div className="toast-region" aria-live="polite">
      <AnimatePresence mode="wait">
        {toast && (
          <motion.p key={toast.id} className="toast" initial={{ opacity: 0, transform: 'translateY(12px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
            {toast.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
