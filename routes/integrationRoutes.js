const express = require('express');
const router = express.Router();
const axios = require('axios');
const File = require('../models/File');
const auth = require('../middleware/auth');

/**
 * @swagger
 * /api/integrations/webhook:
 *   post:
 *     summary: Generic webhook endpoint for file events
 *     tags: [Integrations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed
 */
router.post('/webhook', async (req, res) => {
  try {
    const { event, data } = req.body;

    console.log(`Webhook received: ${event}`, data);

    // Process webhook based on event type
    switch (event) {
      case 'file.uploaded':
        await handleFileUploaded(data);
        break;
      case 'file.deleted':
        await handleFileDeleted(data);
        break;
      case 'file.processed':
        await handleFileProcessed(data);
        break;
      default:
        console.log('Unknown event type');
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/integrations/slack:
 *   post:
 *     summary: Send file notification to Slack
 *     tags: [Integrations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileId:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Notification sent to Slack
 */
router.post('/slack', auth, async (req, res) => {
  try {
    const { fileId, message } = req.body;
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!slackWebhookUrl) {
      return res.status(400).json({ success: false, error: 'Slack webhook URL not configured' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    await axios.post(slackWebhookUrl, {
      text: message || `New file uploaded: ${file.filename}`,
      attachments: [{
        title: file.filename,
        text: `Size: ${(file.size / 1024).toFixed(2)} KB\nType: ${file.mimeType}`,
        color: '#36a64f'
      }]
    });

    res.status(200).json({ success: true, message: 'Notification sent to Slack' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/integrations/dropbox:
 *   post:
 *     summary: Upload file to Dropbox
 *     tags: [Integrations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileId:
 *                 type: string
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: File uploaded to Dropbox
 */
router.post('/dropbox', auth, async (req, res) => {
  try {
    const { fileId, path } = req.body;
    const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;

    if (!dropboxToken) {
      return res.status(400).json({ success: false, error: 'Dropbox token not configured' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Upload to Dropbox API
    const response = await axios.post('https://content.dropboxapi.com/2/files/upload', {
      path: path || `/${file.filename}`,
      mode: 'add',
      autorename: true,
      mute: false
    }, {
      headers: {
        'Authorization': `Bearer ${dropboxToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: path || `/${file.filename}`,
          mode: 'add',
          autorename: true,
          mute: false
        })
      },
      data: file.buffer // Assuming file has buffer stored
    });

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/integrations/google-drive:
 *   post:
 *     summary: Upload file to Google Drive
 *     tags: [Integrations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileId:
 *                 type: string
 *               folderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: File uploaded to Google Drive
 */
router.post('/google-drive', auth, async (req, res) => {
  try {
    const { fileId, folderId } = req.body;
    const googleToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;

    if (!googleToken) {
      return res.status(400).json({ success: false, error: 'Google Drive token not configured' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Upload to Google Drive API
    const metadata = {
      name: file.filename,
      parents: folderId ? [folderId] : []
    };

    const response = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        metadata: JSON.stringify(metadata),
        file: file.buffer
      },
      {
        headers: {
          'Authorization': `Bearer ${googleToken}`,
          'Content-Type': 'multipart/related'
        }
      }
    );

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/integrations/status:
 *   get:
 *     summary: Get integration status
 *     tags: [Integrations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Integration status
 */
router.get('/status', auth, async (req, res) => {
  try {
    const integrations = {
      slack: {
        configured: !!process.env.SLACK_WEBHOOK_URL,
        status: process.env.SLACK_WEBHOOK_URL ? 'active' : 'not configured'
      },
      dropbox: {
        configured: !!process.env.DROPBOX_ACCESS_TOKEN,
        status: process.env.DROPBOX_ACCESS_TOKEN ? 'active' : 'not configured'
      },
      googleDrive: {
        configured: !!process.env.GOOGLE_DRIVE_ACCESS_TOKEN,
        status: process.env.GOOGLE_DRIVE_ACCESS_TOKEN ? 'active' : 'not configured'
      },
      awsS3: {
        configured: !!process.env.AWS_ACCESS_KEY_ID,
        status: process.env.AWS_ACCESS_KEY_ID ? 'active' : 'not configured'
      }
    };

    res.status(200).json({ success: true, integrations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook handlers
async function handleFileUploaded(data) {
  console.log('File uploaded webhook:', data.fileId);
}

async function handleFileDeleted(data) {
  console.log('File deleted webhook:', data.fileId);
}

async function handleFileProcessed(data) {
  console.log('File processed webhook:', data.fileId);
}

module.exports = router;
