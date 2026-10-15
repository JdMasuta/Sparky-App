import { useEffect, useRef, useState } from "react";
import AdminPasswordPrompt from "./AdminPasswordPrompt.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import EntryFormModal from "../admin/EntryFormModal.jsx";
import { api } from "../../lib/api.js";

// Checkout -> "new project" flow: admin password, then the Admin page's
// EntryFormModal. `request` is { kind: "m" | "a", value, existing } where
// `existing` is an INACTIVE project row to reactivate (edit mode) or null to add.
// Reactivation first shows a notice explaining what is needed (with Cancel).
// If this flow created the admin session it signs out again when it finishes,
// so the shop-floor kiosk is never left logged in as admin.
export default function NewProjectFlow({ request, onSaved, onClose }) {
  const [step, setStep] = useState(null); // null | "notice" | "password" | "form"
  const ownsSession = useRef(false);

  const releaseSession = () => {
    if (!ownsSession.current) return;
    ownsSession.current = false;
    api.post("/auth/logout").catch(() => {});
  };

  const cancelled = useRef(false);

  // An admin who is already signed in on this browser skips the password prompt.
  const checkSession = () =>
    api
      .get("/auth/session")
      .then((d) => !cancelled.current && setStep(d.authenticated ? "form" : "password"))
      .catch(() => !cancelled.current && setStep("password"));

  useEffect(() => {
    cancelled.current = false;
    if (!request) {
      setStep(null);
      return;
    }
    if (request.existing) setStep("notice");
    else checkSession();
    return () => {
      cancelled.current = true;
    };
  }, [request]);

  // Sign out if the page unmounts mid-flow.
  useEffect(
    () => () => {
      if (ownsSession.current) api.post("/auth/logout").catch(() => {});
    },
    []
  );

  const finish = (row) => {
    releaseSession();
    setStep(null);
    if (row) onSaved(row);
    else onClose();
  };

  if (!request) return null;

  const { kind, value, existing } = request;
  const initial = existing
    ? { ...existing, status: "ACTIVE" }
    : kind === "m"
      ? { project_number: value.toUpperCase() }
      : { a_number: value.toUpperCase() };

  return (
    <>
      <ConfirmDialog
        isOpen={step === "notice"}
        title="Project is inactive"
        message={`Project ${value} is inactive and must be reactivated before it can be used for a checkout. Continuing asks for the admin password, then lets you set the project back to ACTIVE.`}
        confirmLabel="Continue"
        variant="primary"
        onClose={() => finish(null)}
        onConfirm={() => {
          setStep(null);
          checkSession();
        }}
      />
      <AdminPasswordPrompt
        isOpen={step === "password"}
        message={
          existing
            ? `Project ${value} exists but is inactive. Enter the admin password to reactivate it.`
            : `Project ${value} is not in the database. Enter the admin password to add it.`
        }
        onAuthorized={() => {
          ownsSession.current = true;
          setStep("form");
        }}
        onCancel={() => finish(null)}
      />
      {step === "form" && (
        <EntryFormModal
          isOpen
          table="projects"
          mode={existing ? "edit" : "add"}
          initial={initial}
          flashField={existing ? "status" : undefined}
          refData={{}}
          onClose={() => finish(null)}
          onSaved={(row) => finish(row ?? null)}
        />
      )}
    </>
  );
}
