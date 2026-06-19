import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SymmetriaGrid - Symmetrical Design Studio',
  description: 'Create precise 3-fold rotationally symmetrical patterns with GenAI and precision tools.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased selection:bg-accent selection:text-white">
        {children}
      </body>
    </html>
  );
}
