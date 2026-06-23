import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klipper — AI Video Clipper",
  description: "Paste a URL or upload a video. Get up to 5 AI-generated clips in seconds.",
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
