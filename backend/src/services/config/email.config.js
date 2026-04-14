// src/config/email.config.js
export default {
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  defaults: {
    from: process.env.EMAIL_FROM || '"Cable Audit System"',
  },
};
