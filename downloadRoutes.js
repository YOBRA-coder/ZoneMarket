const express = require('express');
const path = require('path');
const geoip = require('geoip-lite'); // npm install geoip-lite
const router = express.Router();
const Download = require('./models/Download');

// Path to the APK file on disk. Update this whenever you ship a new build,
// or better: keep the filename stable (zonemarket-latest.apk) and just
// overwrite it on deploy so the download link never changes.
const APK_PATH = path.join(__dirname, 'public', 'zonemarket-latest.apk');

// GET /api/apk/download
// Logs the download event, then streams the file to the client.
router.get('/download', async (req, res) => {
  try {
    let ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    // Strip IPv6 prefix that Node adds for local/proxied IPv4 addresses (::ffff:41.90.x.x)
    if (ip?.startsWith('::ffff:')) ip = ip.substring(7);

    const geo = geoip.lookup(ip); // returns null for local/private IPs (e.g. testing on localhost)

    const download = await Download.create({
      ip,
      userAgent: req.headers['user-agent'],
      appVersion: req.query.v || null,
      referrer: req.query.ref || req.headers['referer'] || 'direct',
      country: geo?.country || null,
      region: geo?.region || null,
      city: geo?.city || null,
      lat: geo?.ll?.[0] || null,
      lon: geo?.ll?.[1] || null
    });

    // Push live update to anyone with the download page open (see server.js wiring below)
    const io = req.app.get('io');
    if (io) {
      const total = await Download.countDocuments();
      io.emit('download:new', {
        total,
        city: geo?.city || null,
        country: geo?.country || null
      });
    }

    // res.download sets Content-Disposition so the browser saves it
    // with this filename regardless of the file's actual name on disk.
    res.download(APK_PATH, 'ZoneMarket.apk', (err) => {
      if (err) {
        console.error('APK download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Could not deliver the file. Try again shortly.' });
        }
      }
    });
  } catch (err) {
    console.error('Download logging error:', err);
    // Even if logging fails, don't block the actual download
    res.download(APK_PATH, 'ZoneMarket.apk');
  }
});

// GET /api/apk/stats
// Returns total download count plus a light breakdown, for display on the web page.
router.get('/stats', async (req, res) => {
  try {
    const total = await Download.countDocuments();

    const last7Days = await Download.countDocuments({
      downloadedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    res.json({ total, last7Days });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }
    if (code === 'zonemarket2024') { 
      return res.json({ valid: true });
    }else {
      return res.json({ valid: false });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Could not verify code' });
  }
});

// all downloads

router.get('/downloads', async (req, res) => {
  try {
    const downloads = await Download.find().sort({ downloadedAt: -1 });
    res.json({ downloads: downloads });
  } catch (err) {
    console.error('Error fetching downloads:', err);
    res.status(500).json({ error: 'Could not fetch downloads' });
  }
});


module.exports = router;
