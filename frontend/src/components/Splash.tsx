'use client';

import { useEffect, useState } from 'react';
import { BARBARIAN_OUTLINE, BARBARIAN_VIEWBOX } from './barbarianOutline';

/** Total time on screen before the fade-out starts; the CSS keyframes use the same value. */
const HOLD_MS = 5000;
const FADE_MS = 500;

/**
 * Intro shown on every full page load: a glowing line races around the Barbarian's
 * silhouette while the figure lights up, then the overlay fades into the app.
 *
 * It is rendered into the static HTML so the page underneath never flashes first.
 * The fade is driven by CSS, so the overlay still clears if JavaScript is slow or off;
 * React only removes it from the DOM afterwards. Click or any key skips it.
 */
export default function Splash() {
  const [phase, setPhase] = useState<'show' | 'leaving' | 'gone'>('show');

  useEffect(() => {
    const leave = setTimeout(() => setPhase('leaving'), HOLD_MS);
    const skip = () => setPhase((p) => (p === 'show' ? 'leaving' : p));
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(leave);
      window.removeEventListener('keydown', skip);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div
      className={`splash ${phase === 'leaving' ? 'splash-leaving' : ''}`}
      onClick={() => setPhase('leaving')}
      role="presentation"
    >
      <div className="splash-figure">
        <svg viewBox={BARBARIAN_VIEWBOX} className="splash-outline" aria-hidden>
          <defs>
            {/* clip the art to the traced silhouette so the painted sky behind it never shows as a box */}
            <clipPath id="splash-clip">
              <path d={BARBARIAN_OUTLINE} />
            </clipPath>
            <filter id="splash-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <image
            href="/images/art/barbarian-victorious.webp"
            width="100%"
            height="100%"
            clipPath="url(#splash-clip)"
            className="splash-art"
          />
          {/* the trail the line leaves behind as it draws the full shape */}
          <path d={BARBARIAN_OUTLINE} pathLength={1} className="splash-trail" />
          {/* two bright comets chasing each other around the outline */}
          <path d={BARBARIAN_OUTLINE} pathLength={1} className="splash-comet" filter="url(#splash-glow)" />
          <path d={BARBARIAN_OUTLINE} pathLength={1} className="splash-comet splash-comet-2" filter="url(#splash-glow)" />
        </svg>
      </div>
      <div className="splash-word">WIELER</div>
      <div className="splash-tag">The Barbarian rides. Rallying the raiders…</div>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  );
}
