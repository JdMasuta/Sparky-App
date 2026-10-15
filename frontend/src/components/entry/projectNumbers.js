// Project identifier formats accepted when creating a project from Checkout.
// M-numbers are the project_number; A-numbers are a letter followed by up to
// eight letters/digits (all current values are "A" + 5 digits).
export const M_NUMBER_RE = /^M\d{6}$/i;
export const A_NUMBER_RE = /^[A-Za-z][A-Za-z0-9]{1,8}$/;

/** "m" for an M-number, "a" for an A-number, otherwise null. M wins on overlap. */
export function classifyProjectNumber(value) {
  const v = String(value ?? "").trim();
  if (M_NUMBER_RE.test(v)) return "m";
  if (A_NUMBER_RE.test(v)) return "a";
  return null;
}

/** Find a project (any status) whose project_number or a_number equals value, ignoring case. */
export function findProject(projects, value) {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v) return null;
  return (
    projects.find(
      (p) =>
        String(p.project_number ?? "").toUpperCase() === v ||
        String(p.a_number ?? "").toUpperCase() === v
    ) ?? null
  );
}
