// UI schemas for the Admin Dashboard tables. Mirrors the backend tableRegistry:
// which columns to show, and how to render typed Add/Edit form fields (so the
// old free-text "Add Entry" modal is replaced by proper inputs). Foreign-key
// fields become dropdowns populated from other tables at render time.

export const TABLES = ["users", "projects", "items", "checkouts"];

export const schemas = {
  users: {
    label: "Users",
    pk: "user_id",
    columns: ["user_id", "name", "user_type", "status", "created_at"],
    fields: [
      { name: "name", label: "Name", type: "text", required: true, maxLength: 100 },
      { name: "user_type", label: "User type", type: "text", maxLength: 255, placeholder: "e.g. operator" },
      { name: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    ],
  },
  projects: {
    label: "Projects",
    pk: "project_id",
    columns: ["project_id", "project_number", "name", "a_number", "status", "created_at"],
    fields: [
      { name: "project_number", label: "Project number", type: "text", required: true, maxLength: 50, hint: "Must be unique" },
      { name: "name", label: "Name", type: "text", required: true, maxLength: 100 },
      { name: "a_number", label: "A-number", type: "text", maxLength: 50 },
      { name: "description", label: "Description", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    ],
  },
  items: {
    label: "Items",
    pk: "item_id",
    columns: ["item_id", "sku", "name", "quantity_in_stock", "created_at"],
    fields: [
      { name: "sku", label: "SKU", type: "text", required: true, maxLength: 50, hint: "Must be unique" },
      { name: "name", label: "Name", type: "text", required: true, maxLength: 100 },
      { name: "description", label: "Description", type: "textarea" },
      { name: "quantity_in_stock", label: "Quantity in stock", type: "number", min: 0, default: 0 },
    ],
  },
  checkouts: {
    label: "Checkouts",
    pk: "checkout_id",
    columns: ["checkout_id", "user_id", "project_id", "item_id", "quantity", "timestamp"],
    fields: [
      { name: "user_id", label: "User", type: "fk", ref: "users", refLabel: "name", required: true },
      { name: "project_id", label: "Project", type: "fk", ref: "projects", refLabel: "project_number", required: true },
      { name: "item_id", label: "Item", type: "fk", ref: "items", refLabel: "sku", required: true },
      { name: "quantity", label: "Quantity", type: "number", required: true, min: 0.0001, hint: "Must be greater than 0" },
    ],
  },
};

// Column header labels
export const COLUMN_LABELS = {
  user_id: "ID",
  project_id: "ID",
  item_id: "ID",
  checkout_id: "ID",
  project_number: "Project #",
  a_number: "A-number",
  quantity_in_stock: "In stock",
  created_at: "Added",
  timestamp: "Added",
};

export function columnLabel(key) {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Format a stored "YYYY-MM-DD HH:MM:SS" datetime for display.
export function formatDateTime(value) {
  if (!value) return "—";
  return String(value).slice(0, 16).replace("T", " ");
}
