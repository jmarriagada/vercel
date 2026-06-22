import type { Metadata, Viewport } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-bebas",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SoldeRio — Solar Energy for Homes & Businesses",
  description:
    "SoldeRio delivers premium residential and commercial solar energy systems. Harness the power of the sun and reduce your energy costs with cutting-edge photovoltaic technology.",
  keywords: [
    "solar energy",
    "residential solar",
    "commercial solar",
    "solar panels",
    "photovoltaic",
    "renewable energy",
    "SoldeRio",
  ],
  openGraph: {
    title: "SoldeRio — Solar Energy for Homes & Businesses",
    description:
      "Premium residential and commercial solar energy systems by SoldeRio.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FF8300",
  userScalable: false,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlowCondensed.variable} bg-background`}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
