import type { Variants } from 'motion/react'

/** Soft, no-overshoot ease: a calm reveal suits fine dining better than a bouncy one. */
export const EASE = [0.22, 1, 0.36, 1] as const

export const rise: Variants = {
  hidden: { opacity: 0, transform: 'translateY(24px)' },
  show: { opacity: 1, transform: 'translateY(0px)', transition: { duration: 0.8, ease: EASE } },
}

export const stagger = (each = 0.08, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: each, delayChildren: delay } },
})
