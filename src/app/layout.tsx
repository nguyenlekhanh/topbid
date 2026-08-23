import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Navbar from '@/components/Navbar';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Topbid.lol',
  description: 'A simple public bidding/leaderboard website',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <Navbar />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 text-center text-sm text-muted-foreground">
            Topbid.lol &mdash; Public bidding leaderboard
          </div>
        </footer>
      </body>
    </html>
  );
}
