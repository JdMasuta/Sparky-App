// src/config/email.config.js
const env = "development";

const config = {
  development: {
    service: "gmail", // Using Gmail service instead of direct SMTP config
    auth: {
      user: "bwsparkycart@gmail.com",
      pass: "arrf vmxt cmcs mokt",
    },
    defaults: {
      from: process.env.EMAIL_FROM || '"Cable Audit System"',
    },
  },

  test: {
    service: "gmail",
    auth: {
      user: process.env.TEST_EMAIL_USER || "test@gmail.com",
      pass: process.env.TEST_EMAIL_PASS || "test-password",
    },
    defaults: {
      from:
        process.env.TEST_EMAIL_FROM ||
        '"Cable Audit System Test" <test@gmail.com>',
    },
  },

  production: {
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    defaults: {
      from: process.env.SMTP_FROM,
    },
  },
};

export default config[env];
