import { useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { Input, Select, TextArea } from "../ui/Field.jsx";
import { schemas } from "../../lib/tableSchemas.js";
import { api } from "../../lib/api.js";

// Schema-driven Add/Edit form. Fields are typed (text/number/select/textarea/FK
// dropdown) per tableSchemas, and server-side 4xx errors are surfaced inline on
// the offending field.
export default function EntryFormModal({ isOpen, table, mode, initial, refData, onClose, onSaved }) {
  const schema = schemas[table];
  const [values, setValues] = useState(() => buildInitial(schema, initial));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset local state whenever the modal target changes.
  useMemo(() => {
    setValues(buildInitial(schema, initial));
    setFieldErrors({});
    setFormError("");
  }, [table, initial, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (name, v) => setValues((prev) => ({ ...prev, [name]: v }));

  const validate = () => {
    const errs = {};
    for (const f of schema.fields) {
      const val = values[f.name];
      if (f.required && (val === "" || val === undefined || val === null)) {
        errs[f.name] = `${f.label} is required`;
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = {};
      for (const f of schema.fields) {
        if (values[f.name] !== "" && values[f.name] !== undefined) {
          payload[f.name] = values[f.name];
        }
      }
      if (mode === "edit") {
        await api.put(`/${table}/${initial[schema.pk]}`, payload);
      } else {
        await api.post(`/${table}`, payload);
      }
      onSaved();
    } catch (err) {
      if (err.field) setFieldErrors({ [err.field]: err.message });
      else setFormError(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${mode === "edit" ? "Edit" : "Add"} ${singular(schema.label)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {formError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
        )}
        {schema.fields.map((f) => {
          const common = {
            id: `field-${f.name}`,
            label: f.label,
            required: f.required,
            hint: f.hint,
            error: fieldErrors[f.name],
            value: values[f.name] ?? "",
            onChange: (e) => set(f.name, e.target.value),
          };
          if (f.type === "textarea") return <TextArea key={f.name} {...common} />;
          if (f.type === "select") {
            // Include a legacy/out-of-set current value so it stays visible when
            // editing (e.g. a user whose user_type predates the fixed enum).
            const opts = [...f.options];
            const cur = values[f.name];
            if (cur && !opts.includes(cur)) opts.unshift(cur);
            return (
              <Select
                key={f.name}
                {...common}
                options={opts}
                placeholder={f.required ? undefined : "—"}
              />
            );
          }
          if (f.type === "fk") {
            const options = (refData[f.ref] || []).map((row) => ({
              value: row[schemas[f.ref].pk],
              label: row[f.refLabel] ?? row[schemas[f.ref].pk],
            }));
            return (
              <Select key={f.name} {...common} options={options} placeholder={`Select ${f.label.toLowerCase()}…`} />
            );
          }
          return (
            <Input
              key={f.name}
              {...common}
              type={f.type === "number" ? "number" : "text"}
              min={f.min}
              maxLength={f.maxLength}
              placeholder={f.placeholder}
            />
          );
        })}
      </form>
    </Modal>
  );
}

function buildInitial(schema, initial) {
  const out = {};
  for (const f of schema.fields) {
    if (initial && initial[f.name] !== undefined && initial[f.name] !== null) {
      out[f.name] = initial[f.name];
    } else if (f.default !== undefined) {
      out[f.name] = f.default;
    } else {
      out[f.name] = "";
    }
  }
  return out;
}

function singular(label) {
  return label.endsWith("s") ? label.slice(0, -1) : label;
}
