import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "📡 Morpho Radar",
  description: "Real-time MetaMorpho vault deposit monitor & curator scorecard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-radar-bg text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
