// Flip ACTIVE projects to INACTIVE once their most recent checkout (or, with no
// checkouts, their created_at) is more than two months old. Timestamps are
// stored in local time, so compare against localtime.
export function expireInactiveProjects(db) {
  return db
    .prepare(
      `UPDATE projects
       SET status = 'INACTIVE'
       WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE'
         AND COALESCE(
               (SELECT MAX(c.timestamp) FROM checkouts c WHERE c.project_id = projects.project_id),
               created_at
             ) < datetime('now', 'localtime', '-2 months')`
    )
    .run().changes;
}
