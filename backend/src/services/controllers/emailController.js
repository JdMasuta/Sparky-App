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

// Create transporter with error handling. Never logs credentials.
const createTransporter = () => {
  try {
    console.log("Email transport:", {
      host: emailConfig.host,
      port: emailConfig.port,
      user: emailConfig.auth?.user,
    });

    const transport = nodemailer.createTransport(emailConfig);

    transport.verify(function (error) {
      if (error) {
        console.error("Transporter verification failed:", error.message);
      } else {
        console.log("Server is ready to take our messages");
      }
    });

    return transport;
  } catch (error) {
    console.error("Error creating mail transporter:", error.message);
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

// Method: Send checkout report to every configured recipient in one request.
// The recipient list comes from the DB (same source as the weekly cron), so
// the client no longer loops one POST per recipient.
export const sendCheckoutReportToAll = async (req, res) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: "timestamp parameter is required" });
  }

  const db = getDatabase();
  const recipients = db.prepare("SELECT email FROM report_recipients").all();

  let sent = 0;
  const failures = [];
  for (const { email } of recipients) {
    try {
      await sendReportToEmail(timestamp, email);
      sent += 1;
    } catch (error) {
      // No data for the period fails identically for every recipient — abort.
      if (error.message === "No data found for the specified time period") {
        return res.status(404).json({ error: error.message });
      }
      failures.push({ email, error: error.message });
    }
  }

  res.status(200).json({ requested: recipients.length, sent, failures });
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
    console.error("Error in testEmailConfig:", error.message);
    res.status(500).json({
      message: "Failed to send test email",
      error: error.message,
    });
  }
};
