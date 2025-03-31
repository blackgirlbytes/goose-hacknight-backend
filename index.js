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
    console.log('Loading config from:', configPath);
    
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      console.log('Config file does not exist, creating default config');
      const defaultConfig = { registrationEnabled: false };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    // Read and parse config
    const configContent = fs.readFileSync(configPath, 'utf8');
    console.log('Raw config content:', configContent);
    
    const config = JSON.parse(configContent);
    console.log('Parsed config:', config);
    
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
      name: data.name,
      disabled: data.disabled
    };
  } catch (error) {
    console.error('Error creating OpenRouter key:', error);
    throw error;
  }
}

// List existing keys
async function listKeys() {
  try {
    console.log('Starting to fetch keys...');
    let allKeys = [];
    let offset = 0;
    let hasMore = true;

    // Fetch all pages of keys
    while (hasMore) {
      console.log(`Fetching keys with offset ${offset}...`);
      const url = `https://openrouter.ai/api/v1/keys?include_disabled=true&offset=${offset}`;
      console.log('Requesting URL:', url);
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`Failed to list keys: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Received data:', data);
      
      const keys = data.data || [];
      console.log(`Found ${keys.length} keys in this page`);
      allKeys = allKeys.concat(keys);

      // Check if we need to fetch more pages
      if (keys.length < 100) {
        hasMore = false;
      } else {
        offset += 100;
      }
    }

    console.log(`Total keys found: ${allKeys.length}`);
    return {
      data: allKeys
    };
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

// Disable a specific key
async function disableKey(keyHash) {
  try {
    console.log(`Disabling key: ${keyHash}`);
    const response = await fetch(`https://openrouter.ai/api/v1/keys/${keyHash}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        disabled: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to disable key:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      throw new Error(`Failed to disable key: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Successfully disabled key ${keyHash}:`, data);
    return data;
  } catch (error) {
    console.error(`Error disabling key ${keyHash}:`, error);
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
  console.log('Current registration status:', config.registrationEnabled);
  res.json({
    registrationEnabled: config.registrationEnabled
  });
});

app.post('/api/invite', async (req, res) => {
  try {
    // Check if registration is enabled
    const config = loadConfig();
    console.log('Checking registration status for invite:', config.registrationEnabled);
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
      disabled: keyData.disabled,
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

// Disable all keys
app.post('/api/admin/keys/disable-all', adminAuth, async (req, res) => {
  try {
    console.log('Starting disable-all operation...');
    const keys = (await listKeys()).data;
    console.log(`Found ${keys.length} keys to disable`);
    
    const disabledKeys = await Promise.all(
      keys.map(async (key) => {
        try {
          const result = await disableKey(key.hash);
          return {
            ...key,
            disabled: true
          };
        } catch (error) {
          console.error(`Failed to disable key ${key.hash}:`, error);
          return key; // Return original key if disable failed
        }
      })
    );
    
    // Fetch fresh key data to ensure we have the latest state
    const updatedKeys = await listKeys();
    console.log('Updated keys after disable-all:', updatedKeys);
    
    res.json({
      success: true,
      message: `Successfully processed ${keys.length} keys`,
      data: updatedKeys.data
    });
  } catch (error) {
    console.error('Error in disable-all:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to disable keys', 
      error: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});