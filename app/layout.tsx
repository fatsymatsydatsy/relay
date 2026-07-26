import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "MedFind — find your medication in stock",
  description:
    "We phone open pharmacies near you and report live which ones actually have your medication.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
        <footer
          style={{
            padding: "16px 24px",
            fontSize: 13,
            color: "#5a6b7d",
            borderTop: "1px solid #d8e1e9",
            marginTop: 48,
          }}
        >
          MedFind checks pharmacy stock availability. It does not provide
          medical advice. Always consult your pharmacist or GP. In an emergency
          call 999; for urgent medicine needs call NHS 111.
        </footer>
      </body>
    </html>
  );
}
