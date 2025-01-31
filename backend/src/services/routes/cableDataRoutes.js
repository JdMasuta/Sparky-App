import express from "express";
import {
  getLatestCheckouts,
  getCheckoutById,
  createCheckout,
  createProject,
  getCheckoutsTimestamp,
  getUserById,
  getItemById,
  getProjectById,
  generateCheckoutReport,
  getTableData,
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

// Route: Get all checkouts on or after a given timestamp
router.post("/checkout_afterTime", getCheckoutsTimestamp);

// Route: Generate checkout report for entries after a given timestamp
router.post("/checkout_report", generateCheckoutReport);

// Route: Get a single checkout by checkout_id
router.get("/checkout_id/", getCheckoutById);

// Route: Get the latest 'n' checkouts
router.get("/checkouts/simple/:n", getLatestCheckouts);

// Route: Get user by user_id
router.get("/user/:id", getUserById);

// Route: Get project by project_id
router.get("/project/:id", getProjectById);

// Route: Get item by item_id
router.get("/item/:id", getItemById);

// Route: Get all users, projects, and items
router.get("/table_data", getTableData);

// Route: Create a new checkout
router.post("/checkout/old", createCheckout);

// Route: Create a new project
router.post("/project", createProject);

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
