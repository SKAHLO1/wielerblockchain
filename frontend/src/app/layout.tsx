import type { Metadata, Viewport } from 'next';
import '@near-wallet-selector/modal-ui/styles.css';
import './globals.css';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: 'WIELER · Stake. Raid. Conquer.',
  description: 'A NEAR memecoin with real conquests across chains.',
  icons: { icon: '/images/art/icon-coin.webp' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#050c20' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
