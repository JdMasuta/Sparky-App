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

const router = express.Router();

// Route: Generate checkout report for entries after a given timestamp
router.post("/checkout_report", generateCheckoutReport);

// Route: Get all users, projects, and items
router.get("/table_data", getTableData);

// Route: Get active entries for a given table
router.get("/table_data/active", getActiveTableData);

// Route: Delete all invalid checkouts
router.delete("/purge", deleteInvalidCheckouts);

// New optimized routes

// Route: Get the latest 'n' checkouts with detailed information
router.get("/checkouts/detailed/:n", getLatestCheckoutsWithDetails);

// Route: Get checkout statistics
router.get("/checkouts/stats", getCheckoutStats);

// Route: Get all checkouts on or after a given timestamp with detailed information
router.post("/checkouts/detailed/after", getCheckoutsAfterTimestampWithDetails);

// RESTful API

// CRUD operations
router.get("/:table/:id", getById);
router.post("/:table", createEntry);
router.put("/:table/:id", updateEntry);
router.delete("/:table/:id", deleteEntry);

// General data retrieval
router.get("/:table", getAllData);

export default router;
