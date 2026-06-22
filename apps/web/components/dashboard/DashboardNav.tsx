"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import styles from "./DashboardNav.module.css";

interface Props {
  user: User;
  profile: { username: string | null; avatar_url: string | null } | null;
}

export default function DashboardNav({ user, profile }: Props) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const displayName = profile?.username ?? user.email ?? "Account";

  return (
    <nav className={styles.nav}>
      <span className={styles.wordmark}>KLIPPER</span>
      <div className={styles.right}>
        <span className={styles.identity}>{displayName}</span>
        <button className={styles.signOut} onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
