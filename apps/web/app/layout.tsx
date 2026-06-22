import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klipper",
  description: "AI-assisted video clipping and publishing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
