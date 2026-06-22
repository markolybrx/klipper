import { createClient } from "@/lib/supabase/server";
import styles from "./dashboard.module.css";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user!.id)
    .single();

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Projects</h1>
        <p className={styles.pageSubtitle}>
          Welcome{profile?.username ? `, ${profile.username}` : ""}. Upload a
          video or paste a URL to create your first project.
        </p>
      </div>
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}>[ ]</span>
        <p className={styles.emptyText}>No projects yet.</p>
        <p className={styles.emptyHint}>
          Video ingestion coming in the next phase.
        </p>
      </div>
    </div>
  );
}
