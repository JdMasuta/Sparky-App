import express from "express";
import {
  generateCheckoutReport,
  getTableData,
  getActiveTableData,
  deleteInvalidCheckouts,
  // New optimized methods
  getLatestCheckoutsWithDetails,
  getCheckoutStats,
  getCheckoutsAfterTimestampWithDetails,
  // New RESTful methods
  getAllData,
  getById,
  createEntry,
  updateEntry,
  deleteEntry,
} from "../controllers/databaseController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

// Route: Generate checkout report for entries after a given timestamp
router.post("/checkout_report", generateCheckoutReport);

// Route: Get all users, projects, and items
router.get("/table_data", getTableData);

// Route: Get active entries for a given table
router.get("/table_data/active", getActiveTableData);

// Route: Delete all invalid checkouts (admin only)
router.delete("/purge", requireAdmin, deleteInvalidCheckouts);

// New optimized routes

// Route: Get the latest 'n' checkouts with detailed information
router.get("/checkouts/detailed/:n", getLatestCheckoutsWithDetails);

// Route: Get checkout statistics
router.get("/checkouts/stats", getCheckoutStats);

// Route: Get all checkouts on or after a given timestamp with detailed information
router.post("/checkouts/detailed/after", getCheckoutsAfterTimestampWithDetails);

// RESTful API
//
// Reads stay open (the Report page and Checkout option lists depend on them).
// Creating a checkout is the operator's one write and stays open (validated
// server-side). Every OTHER mutation — creating non-checkout rows, and all
// updates/deletes — requires an admin session + CSRF header.

// Operator: submit a checkout (open, but FK/quantity validated). The static
// path has no :table param, so inject it for the shared createEntry handler.
router.post(
  "/checkouts",
  (req, _res, next) => {
    req.params.table = "checkouts";
    next();
  },
  createEntry
);

// Admin-only writes.
router.post("/:table", requireAdmin, createEntry);
router.put("/:table/:id", requireAdmin, updateEntry);
router.delete("/:table/:id", requireAdmin, deleteEntry);

// General data retrieval (open).
router.get("/:table/:id", getById);
router.get("/:table", getAllData);

export default router;
