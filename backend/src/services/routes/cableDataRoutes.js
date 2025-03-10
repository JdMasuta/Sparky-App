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

// Route: Get active entries for a given table
// This route is now optimized to handle only the "table_data" table
// and to skip the /:table/:id route
router.use((req, res, next) => {
  if (req.path === "/table_data/active") {
    return getActiveTableData(req, res, next);
  }
  next();
});

// Route: Generate checkout report for entries after a given timestamp
router.post("/checkout_report", generateCheckoutReport);

// Route: Get all users, projects, and items
router.get("/table_data", getTableData);

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
router.get("/:table/:id", (req, res, next) => {
  // Skip this route handler if the table is "table_data" and id is "active"
  if (req.params.table === "table_data" && req.params.id === "active") {
    return next("route");
  }
  getById(req, res, next);
});
router.post("/:table", createEntry);
router.put("/:table/:id", updateEntry);
router.delete("/:table/:id", deleteEntry);

// General data retrieval
router.get("/:table", getAllData);

export default router;
