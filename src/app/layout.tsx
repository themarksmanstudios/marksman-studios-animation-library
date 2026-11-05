import type { Metadata, Viewport } from 'next';
import './globals.css';
import './production.css';

export const metadata: Metadata = {
  title: 'Animation Production Dashboard · Marksman Studios',
  description: 'Marksman Studios internal motion capture catalogue, production tracker, and animation reference desk.',
};
export const viewport: Viewport = { themeColor: '#f5f5f2' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Keep fonts optional at runtime so offline builds work. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
