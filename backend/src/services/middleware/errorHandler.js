// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Database errors
  if (
    [
      "ER_NO_SUCH_TABLE",
      "ER_BAD_FIELD_ERROR",
      "ER_PARSE_ERROR",
      "ER_DUP_ENTRY",
      "ER_NO_REFERENCED_ROW_2",
      "ER_ROW_IS_REFERENCED_2",
      "ER_LOCK_WAIT_TIMEOUT",
      "ER_LOCK_DEADLOCK",
    ].includes(err.code)
  ) {
    return res.status(500).json({
      error: "Database error occurred",
      message: `An error occurred while accessing the database: ${err.code}`,
    });
  }

  // PLC connection errors
  if (err.message.includes("DDE")) {
    return res.status(503).json({
      error: "PLC communication error",
      message: "Unable to communicate with PLC",
    });
  }

  // Other errors
  res.status(300).json({
    error: "Internal Server Error 300",
    message: err.message,
  });
  res.status(400).json({
    error: "Internal Server Error 400",
    message: err.message,
  });
  res.status(500).json({
    error: "Internal Server Error 500",
    message: err.message,
  });
};

export default errorHandler;
