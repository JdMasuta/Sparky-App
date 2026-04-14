// src/controllers/emailReportController.js
import { getDatabase } from "../../init/db.init.js";
import nodemailer from "nodemailer";
import emailConfig from "../config/email.config.js";
import { generateHTMLTable } from "../templates/report.js";

// Initialize the transporter outside of the request handlers but wrap it in a function
// to prevent immediate connection attempts during module loading
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport(emailConfig);
  }
  return transporter;
};

// Create transporter with error handling
const createTransporter = () => {
  try {
    // Log email configuration (excluding sensitive data in production)
    console.log("Email Config:", {
      host: emailConfig.host,
      port: emailConfig.port,
      auth: {
        user: emailConfig.auth.user,
        // Log partial password for debugging (last 4 chars)
        pass: emailConfig.auth.pass
          ? `...${emailConfig.auth.pass.slice(-4)}`
          : "undefined",
      },
    });

    const transport = nodemailer.createTransport(emailConfig);

    // Verify the connection configuration
    transport.verify(function (error, success) {
      if (error) {
        console.error("Transporter verification failed:", error);
        console.log("Auth details - Username:", emailConfig.auth.user);
        // Only log password in development
        if (process.env.NODE_ENV !== "production") {
          console.log("Auth details - Password:", emailConfig.auth.pass);
        }
      } else {
        console.log("Server is ready to take our messages");
      }
    });

    return transport;
  } catch (error) {
    console.error("Error creating mail transporter:", error);
    // Log authentication details on error
    console.error("Email authentication failed with credentials:", {
      username: emailConfig.auth.user,
      password:
        process.env.NODE_ENV !== "production"
          ? emailConfig.auth.pass
          : "[REDACTED]",
    });
    throw error;
  }
};

// Extracted core logic: fetch data and send to a single email address. Throws on failure.
export async function sendReportToEmail(timestamp, email) {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT
        p.project_number,
        p.a_number,
        i.sku AS item_sku,
        i.name AS item_name,
        SUM(c.quantity) AS total_quantity
      FROM checkouts c
      JOIN projects p ON c.project_id = p.project_id
      JOIN items i ON c.item_id = i.item_id
      WHERE c.timestamp >= ?
      GROUP BY p.a_number, i.sku, i.name
      ORDER BY p.a_number, i.sku, i.name`
    )
    .all(timestamp);

  if (rows.length === 0) throw new Error('No data found for the specified time period');

  const htmlContent = generateHTMLTable(rows);
  await getTransporter().sendMail({
    from: emailConfig.defaults.from,
    to: email,
    subject: 'Cable Audit System - Checkout Report',
    html: `<h1>Cable Audit System - Weekly Checkout Report</h1>
           <p>Checkout report from ${timestamp}:</p>${htmlContent}`,
  });
}

// Method: Send checkout report via email
export const sendCheckoutReport = async (req, res) => {
  const { timestamp, email } = req.body;

  if (!timestamp || !email) {
    return res
      .status(400)
      .send("Both timestamp and email parameters are required");
  }

  try {
    await sendReportToEmail(timestamp, email);
    res.status(200).json({
      message: "Report sent successfully",
      timestamp: timestamp,
      recipient: email,
    });
  } catch (error) {
    console.error("Error in sendCheckoutReport:", error);
    if (error.message === 'No data found for the specified time period') {
      return res.status(404).send(error.message);
    }
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Method: Test email configuration
export const testEmailConfig = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send("Email parameter is required");
  }

  try {
    const mailTransporter = getTransporter();
    const testMailOptions = {
      from: emailConfig.from,
      to: email,
      subject: "Cable Audit System - Email Configuration Test",
      text: "This is a test email from the Cable Audit System. If you receive this, the email configuration is working correctly.",
    };

    await mailTransporter.sendMail(testMailOptions);

    res.status(200).json({
      message: "Test email sent successfully",
      recipient: email,
    });
  } catch (error) {
    console.error("Error in testEmailConfig:", error);
    // Add detailed error logging
    console.error("Email configuration details:", {
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: {
        user: emailConfig.auth.user,
        pass:
          process.env.NODE_ENV !== "production"
            ? emailConfig.auth.pass
            : "[REDACTED]",
      },
    });
    res.status(500).json({
      message: "Failed to send test email",
      error: error.message,
    });
  }
};
