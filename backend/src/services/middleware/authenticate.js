// backend/src/services/middleware/authenticate.js
import { securityConfig } from "../config/server.config.js";

// Middleware to verify API access
const authenticate = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== securityConfig.apiKey) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid API key",
    });
  }

  // Add user info to the request for logging purposes
  req.user = "api-user";

  next();
};

export default authenticate;
