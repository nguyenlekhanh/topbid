import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Navbar from '@/components/Navbar';
import PublicAnalytics from '@/components/PublicAnalytics';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Task 10.5: site-wide metadata. metadataBase resolves relative OG/twitter URLs
// against the single trusted origin (the same NEXT_PUBLIC_APP_URL every other URL
// builder uses); it is omitted when unconfigured so local builds never crash - Next.js
// then falls back to relative resolution with a warning instead of an error.
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || null;

export const metadata: Metadata = {
  ...(appUrl ? { metadataBase: new URL(appUrl) } : {}),
  title: 'Topbid.lol',
  description: 'A simple public bidding/leaderboard website',
  openGraph: {
    type: 'website',
    siteName: 'Topbid.lol',
    ...(appUrl ? { url: appUrl } : {}),
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <Navbar />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <PublicAnalytics />
        <footer className="border-t border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 text-center text-sm text-muted-foreground">
            Topbid.lol &mdash; Public bidding leaderboard
          </div>
        </footer>
      </body>
    </html>
  );
}
