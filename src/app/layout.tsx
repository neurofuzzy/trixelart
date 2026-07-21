import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Trixel",
  description: "Infinite Triangular Drawing Grid",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Trixel",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#09090b",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.className} bg-background text-foreground overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
