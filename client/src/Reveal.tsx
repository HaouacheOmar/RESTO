import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { stagger } from './motion'

interface RevealProps {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'ul' | 'header'
  each?: number
}

/** Reveals its `rise` children in sequence the first time it scrolls into view. */
export function Reveal({ children, className, as = 'div', each = 0.08 }: RevealProps) {
  const Tag = motion[as]
  return (
    <Tag className={className} variants={stagger(each)} initial="hidden" whileInView="show"
      viewport={{ once: true, amount: 0.25 }}>
      {children}
    </Tag>
  )
}
