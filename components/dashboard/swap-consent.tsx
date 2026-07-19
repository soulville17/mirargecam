'use client'

import { Check } from 'lucide-react'

/**
 * Case de certification a afficher avant chaque face swap.
 * Le bouton Demarrer doit rester desactive tant que `checked` est faux.
 * Le consentement est persiste par la page dans localStorage
 * (`mirargecam_swap_consent`).
 */
export function SwapConsent({
  checked,
  onChange,
  className = '',
}: {
  checked: boolean
  onChange: (value: boolean) => void
  className?: string
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border border-[#222] bg-[#111]/60 p-3 backdrop-blur-md transition-colors hover:border-[#00ff88]/30 ${className}`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
          checked ? 'border-[#00ff88] bg-[#00ff88] text-black' : 'border-[#333] bg-transparent'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Je certifie disposer des autorisations necessaires"
      />
      <span className="text-xs leading-relaxed text-gray-400">
        Je certifie disposer des autorisations nécessaires et utiliser MirageCam conformément aux lois applicables.
      </span>
    </label>
  )
}

/** Petit texte discret a placer sous le bouton Demarrer. */
export function GenerateNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-[11px] leading-relaxed text-gray-500 ${className}`}>
      En générant ce contenu, vous confirmez respecter les Conditions d&apos;utilisation de MirageCam.
    </p>
  )
}
