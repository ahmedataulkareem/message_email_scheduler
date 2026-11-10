import type { ReactNode } from "react";
import { signOut } from "./login/actions";
import "./globals.css";

export const metadata = { title: "Constituent Messaging" };

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/suppressions", label: "Suppressions" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          {NAV.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
          <form action={signOut} style={{ marginLeft: "auto" }}>
            <button type="submit" className="link">
              Sign out
            </button>
          </form>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
