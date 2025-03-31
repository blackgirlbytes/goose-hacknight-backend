require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Load registration configuration
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config;
  } catch (error) {
    console.error('Error loading config:', error);
    return { registrationEnabled: false }; // Default to disabled if config can't be loaded
  }
}

app.use(cors());
app.use(express.json());

// Admin middleware to check for admin token
const adminAuth = (req, res, next) => {
  const adminToken = req.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized access' 
    });
  }
  next();
};

// Function to check if an email has already been used
async function checkExistingEmail(email) {
  try {
    let allKeys = [];
    let offset = 0;
    let hasMore = true;

    // Fetch all pages of keys
    while (hasMore) {
      const response = await fetch(`https://openrouter.ai/api/v1/keys?offset=${offset}`, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch keys: ${response.statusText}`);
      }

      const data = await response.json();
      const keys = data.data || [];
      allKeys = allKeys.concat(keys);

      // Check if we need to fetch more pages
      if (keys.length < 100) {
        hasMore = false;
      } else {
        offset += 100;
      }
    }

    // Search for a key with matching email in name
    const expectedName = `Goose Hacknight - ${email}`;
    return allKeys.some(key => key.name === expectedName);
  } catch (error) {
    console.error('Error checking existing email:', error);
    throw error;
  }
}

// Create an OpenRouter API key for the user
async function createOpenRouterKey(email) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/keys', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Goose Hacknight - ${email}`,
        label: email.replace('@', '-at-'), // Create a URL-safe label from email
        limit: parseInt(process.env.OPENROUTER_PRESET_CREDITS) || 5 // Default credit limit if not specified
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenRouter API Error:', error);
      throw new Error(error.message || `Failed to create OpenRouter API key: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      key: data.key,
      keyHash: data.hash,
      limit: data.limit,
      name: data.name
    };
  } catch (error) {
    console.error('Error creating OpenRouter key:', error);
    throw error;
  }
}

// List existing keys
async function listKeys() {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/keys', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list keys: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error listing keys:', error);
    throw error;
  }
}

// Delete a specific key
async function deleteKey(keyHash) {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1/keys/${keyHash}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to delete key: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Error deleting key:', error);
    throw error;
  }
}

// Add a root route handler
app.get('/', (req, res) => {
  res.json({ message: 'Goose Hacknight API is running' });
});

// Endpoint to check registration status
app.get('/api/registration-status', (req, res) => {
  const config = loadConfig();
  res.json({
    registrationEnabled: config.registrationEnabled
  });
});

app.post('/api/invite', async (req, res) => {
  try {
    // Check if registration is enabled
    const config = loadConfig();
    if (!config.registrationEnabled) {
      return res.status(403).json({
        success: false,
        message: 'Registration is currently closed'
      });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email is required' 
      });
    }

    console.log(`\nProcessing registration for ${email}...`);

    // Check if email has already been used
    const exists = await checkExistingEmail(email);
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'This email has already been registered for the hackathon.'
      });
    }

    // Create OpenRouter API key
    console.log('Creating OpenRouter API key...');
    const keyData = await createOpenRouterKey(email);

    // Send success response
    res.json({
      success: true,
      apiKey: keyData.key,
      keyHash: keyData.keyHash,
      limit: keyData.limit,
      name: keyData.name,
      message: 'Your OpenRouter API key has been created successfully.'
    });

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to create API key', 
      error: error.message 
    });
  }
});

// Admin Routes
app.get('/api/admin/keys', adminAuth, async (req, res) => {
  try {
    const keys = await listKeys();
    res.json(keys);
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to list keys', 
      error: error.message 
    });
  }
});

// Delete all keys
app.post('/api/admin/keys/delete-all', adminAuth, async (req, res) => {
  try {
    const keys = (await listKeys()).data;
    await Promise.all(
      keys.map(key => deleteKey(key.hash))
    );
    res.json({
      success: true,
      message: `Successfully deleted ${keys.length} keys`
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete keys', 
      error: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});