import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Sakshya - evidence-first scrutiny support for AICTE (SIH26261)',
  description: 'Evidence-linked, rule-based decision support for AICTE application scrutiny. Agents propose, rules verify, humans decide.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <SessionProvider>
            <AppShell>{children}</AppShell>
            <Toaster position="top-right" richColors closeButton />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
