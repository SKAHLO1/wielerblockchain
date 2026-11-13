import React from 'react';

type P = { size?: number; className?: string };

const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconHome = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3L12 3Z" />
  </svg>
);
export const IconGlobe = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
  </svg>
);
export const IconCoins = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
    <path d="M5 5.5v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4M5 9.5v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4M5 13.5v4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-4" />
  </svg>
);
export const IconTrophy = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M7 3h10v2h4v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V5h4V3Zm0 4H5v1a3 3 0 0 0 2 2.8V7Zm10 0v3.8A3 3 0 0 0 19 8V7h-2Z" />
  </svg>
);
export const IconGift = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 3.8C6 4.5 7 8 12 8Zm0 0s1.5-5 4-4.2c2 .7 1 4.2-4 4.2Z" />
  </svg>
);
export const IconExternal = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconBook = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5V5.5ZM12 6v13.5" />
  </svg>
);
export const IconWallet = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" />
    <path d="M16 13.5h.01" strokeWidth="3" />
  </svg>
);
export const IconBell = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2.2 2.2 0 0 0 4 0" />
  </svg>
);
export const IconClock = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M5 4 2.5 6.5M19 4l2.5 2.5" />
  </svg>
);
export const IconChevronDown = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const IconArrowRight = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconUser = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <circle cx="12" cy="8" r="4.2" />
    <path d="M3.5 21c.8-4.6 4.3-7 8.5-7s7.7 2.4 8.5 7h-17Z" />
  </svg>
);
export const IconCrown = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7Zm2 13h14v2H5v-2Z" />
  </svg>
);
export const IconFlame = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M12 2c1 3.5 5.5 6 5.5 11.2A5.6 5.6 0 0 1 12 19a5.6 5.6 0 0 1-5.5-5.8c0-2.4 1.2-4 2.5-5.2.2 1.7.9 2.8 2 3.4C10.6 8.6 11 5 12 2Z" />
  </svg>
);
export const IconShield = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 3.2 5 1.9V11c0 3.5-2.1 6.7-5 8V5.2Z" />
  </svg>
);
export const IconStar = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="m12 2 3 6.6 7.1.7-5.4 4.8 1.6 7-6.3-3.8-6.3 3.8 1.6-7L1.9 9.3 9 8.6 12 2Z" />
  </svg>
);
export const IconFlag = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M5 2h2v20H5V2Zm3 1h11l-2.5 4.5L19 12H8V3Z" />
  </svg>
);
export const IconSwap = ({ size, className }: P) => (
  <svg {...base(size)} className={className} strokeWidth={2.4}>
    <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
  </svg>
);
export const IconSword = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2" />
  </svg>
);
export const IconMenu = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const IconClose = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconWarn = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" />
  </svg>
);

// ----------------------------------------------------------------- chain marks

export function ChainIcon({ id, size = 28 }: { id: string; size?: number }) {
  switch (id) {
    case 'bitcoin':
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Bitcoin">
          <circle cx="16" cy="16" r="16" fill="#f7931a" />
          <path
            fill="#fff"
            d="M22.6 14c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.7 2.6-1.3-.3.7-2.7-1.6-.4-.7 2.7-1-.2-2.3-.6-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-.8 3.1.2.1-.2-.1-1.1 4.4c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5 1.2.3-.7 2.8 1.6.4.7-2.7 1.3.3-.7 2.7 1.6.4.7-2.8c2.8.5 4.9.3 5.8-2.2.7-2-.1-3.2-1.5-4 1.1-.2 1.9-.9 2.1-2.4Zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3Zm.5-5.3c-.5 1.8-3.3.9-4.2.7l.8-3.2c.9.2 3.9.6 3.4 2.5Z"
          />
        </svg>
      );
    case 'ethereum':
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Ethereum">
          <g fill="#e6ecff">
            <path d="M16 2 7.5 16.3 16 21.3l8.5-5L16 2Z" opacity=".95" />
            <path d="M16 23 7.5 18 16 30l8.5-12L16 23Z" />
            <path d="M16 2v19.3l8.5-5L16 2Z" fill="#9db0ff" />
            <path d="M16 23v7l8.5-12L16 23Z" fill="#9db0ff" />
          </g>
        </svg>
      );
    case 'solana':
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Solana">
          <defs>
            <linearGradient id="solg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#9945ff" />
              <stop offset="1" stopColor="#14f195" />
            </linearGradient>
          </defs>
          <g fill="url(#solg)">
            <path d="M8 8h18l-3 3.5H5L8 8Z" />
            <path d="M5 14.3h18l3 3.5H8l-3-3.5Z" />
            <path d="M8 20.5h18l-3 3.5H5l3-3.5Z" />
          </g>
        </svg>
      );
    case 'near':
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" aria-label="NEAR">
          <path
            fill="#fff"
            d="M22.2 4.6 18 10.8c-.3.4.3 1 .7.6l4.1-3.6c.1-.1.3 0 .3.2v11.5c0 .2-.2.3-.3.1L10.4 4.9A2.7 2.7 0 0 0 8.4 4h-.4A2.7 2.7 0 0 0 5.3 6.7v18.6A2.7 2.7 0 0 0 8 28c.9 0 1.8-.5 2.3-1.3L14.5 20.5c.3-.4-.3-1-.7-.6l-4.1 3.6c-.1.1-.3 0-.3-.2V11.8c0-.2.2-.3.3-.1l12.4 14.4c.5.6 1.2.9 2 .9h.4a2.7 2.7 0 0 0 2.7-2.7V6.7A2.7 2.7 0 0 0 24.5 4c-.9 0-1.8.5-2.3 1.3Z"
          />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="15" fill="#2a3b6e" />
        </svg>
      );
  }
}

// Cropped from tools/asset-sheet.webp by tools/crop-assets.py. The sheet has no Bitcoin
// fortress, so Bitcoin raids use the conquest battlefield.
export const chainArt: Record<string, string> = {
  bitcoin: '/images/art/battlefield.webp',
  ethereum: '/images/art/fortress-eth.webp',
  solana: '/images/art/citadel-sol.webp',
  near: '/images/art/keep-near.webp',
};

export const chainBanner: Record<string, string> = {
  bitcoin: '/images/art/banner-btc.webp',
  ethereum: '/images/art/banner-eth.webp',
  solana: '/images/art/banner-sol.webp',
  near: '/images/art/banner-near.webp',
};

export const ART = {
  barbarianFull: '/images/art/barbarian-full.webp',
  barbarianPortrait: '/images/art/barbarian-portrait.webp',
  barbarianAttacking: '/images/art/barbarian-attacking.webp',
  barbarianDefending: '/images/art/barbarian-defending.webp',
  barbarianVictorious: '/images/art/barbarian-victorious.webp',
  bannerW: '/images/art/banner-w.webp',
  throne: '/images/art/throne-wieler.webp',
  kingdom: '/images/art/kingdom.webp',
  battlefield: '/images/art/battlefield.webp',
  raiders: '/images/art/raiders.webp',
  clanLeader: '/images/art/clan-leader.webp',
  conqueror: '/images/art/conqueror.webp',
  keep: '/images/art/keep-near.webp',
  coin: '/images/art/icon-coin.webp',
  trophy: '/images/art/icon-trophy.webp',
  shield: '/images/art/icon-shield.webp',
  helmet: '/images/art/icon-helmet.webp',
  chest: '/images/art/icon-chest.webp',
  scroll: '/images/art/icon-scroll.webp',
};
