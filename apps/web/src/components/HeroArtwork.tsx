/**
 * Hero artwork slot.
 *
 * The design direction calls for one painted landscape moment as the only saturated
 * colour in the system. Until a final illustration is commissioned this renders a soft
 * abstract horizon in the Metrx palette — deliberately quiet, grain over gradient, no
 * crypto neon. Swap the whole component for an <img> when the artwork lands.
 */
export function HeroArtwork() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <svg className="h-full w-full" viewBox="0 0 1440 620" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7F1E8" />
            <stop offset="46%" stopColor="#F2E6D6" />
            <stop offset="78%" stopColor="#E7D6BE" />
            <stop offset="100%" stopColor="#DCC9AE" />
          </linearGradient>
          <radialGradient id="sun" cx="0.62" cy="0.86" r="0.42">
            <stop offset="0%" stopColor="#D7A04A" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#D7A04A" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#D7A04A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ridgeFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#083B32" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#083B32" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="ridgeNear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#083B32" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#083B32" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id="fadeOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7F1E8" stopOpacity="0" />
            <stop offset="70%" stopColor="#F7F1E8" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#F7F1E8" stopOpacity="1" />
          </linearGradient>
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>

        <rect width="1440" height="620" fill="url(#sky)" />
        <rect width="1440" height="620" fill="url(#sun)" />

        <path d="M0 470 C 210 402, 336 452, 512 424 C 700 394, 828 446, 1010 414 C 1188 383, 1310 430, 1440 404 L1440 620 L0 620 Z" fill="url(#ridgeFar)" />
        <path d="M0 528 C 190 486, 348 524, 528 498 C 742 468, 880 516, 1064 494 C 1236 474, 1330 508, 1440 492 L1440 620 L0 620 Z" fill="url(#ridgeNear)" />

        {/* Settlement motif: three quiet markers on the horizon — fund, verify, settle. */}
        <g opacity="0.5">
          <circle cx="392" cy="452" r="3.5" fill="#083B32" />
          <circle cx="720" cy="432" r="3.5" fill="#14C79A" />
          <circle cx="1048" cy="446" r="3.5" fill="#083B32" />
          <path d="M392 452 L720 432 L1048 446" stroke="#083B32" strokeOpacity="0.35" strokeWidth="1" fill="none" />
        </g>

        <rect width="1440" height="620" fill="url(#fadeOut)" />
        <rect width="1440" height="620" filter="url(#grain)" opacity="0.05" />
      </svg>
    </div>
  );
}
