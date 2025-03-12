require('dotenv').config();

module.exports = {
  adminUsers: [
    {
      username: process.env.ADMIN_USERNAME || 'admin',
      // In production, this should be a hashed password
      password: process.env.ADMIN_PASSWORD || 'your-secure-password'
    }
  ],
  jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-key',
  provisioningKey: process.env.OPENROUTER_PROVISIONING_KEY
};