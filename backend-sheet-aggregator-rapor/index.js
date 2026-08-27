const path = require('path');
const fs = require('fs');

if (fs.existsSync(path.resolve(__dirname, '../.env'))) {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} else {
    require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { initDB, getLatestNavTree } = require('./database');
const apiRoutes = require('./routes/api');
const { initCronJobs } = require('./cron');
const { runSync } = require('./services/syncService');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Caddy)

// ─── CORS ────────────────────────────────────────────────────────────────────
// Only allow requests from the configured domain.
// DOMAIN=localhost for local dev (allows http://localhost and http://localhost:4321)
// DOMAIN=your.domain.com for production (allows https://your.domain.com)
const domain = process.env.DOMAIN || 'localhost';
const allowedOrigins = domain === 'localhost'
    ? ['http://localhost', 'http://localhost:4321', 'http://127.0.0.1']
    : [`https://${domain}`];
app.use(cors({ origin: allowedOrigins }));

app.use(express.json());

const port = process.env.PORT || 3000;

// ─── API Key Middleware (The Bouncer) ────────────────────────────────────────
// Protects all /api routes by requiring a matching x-api-key header.
// Set API_SECRET_KEY in your .env file. Generate a strong key with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
if (!process.env.API_SECRET_KEY) {
    console.warn('⚠️  WARNING: API_SECRET_KEY is not set in .env. All /api routes are unprotected!');
}

const requireApiKey = (req, res, next) => {
    // 1. Check programmatic API Key (header only — never accept secrets in query params)
    const clientKey = req.headers['x-api-key'];
    if (clientKey && clientKey === process.env.API_SECRET_KEY) {
        return next();
    }

    // 2. Check Admin Password (header only — never accept secrets in query params)
    const adminPassword = req.headers['x-admin-password'];
    if (adminPassword && process.env.ADMIN_PASSWORD_HASH) {
        const hash = crypto.createHash('sha256').update(adminPassword.trim()).digest('hex');
        if (hash === process.env.ADMIN_PASSWORD_HASH) {
            return next();
        }
    }

    return res.status(403).json({ error: 'Forbidden: Invalid or missing credentials.' });
};

// ─── Rate Limiter ────────────────────────────────────────────────────────────
// Limits each IP to 100 requests per 15 minutes on all /api routes.
// This prevents brute-force attacks against the auth middleware.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

// Apply the rate limiter first, then the API key check to ALL /api/* routes
app.use('/api', apiLimiter);
app.use('/api', requireApiKey);

app.use('/api/rapor', apiRoutes);

app.get('/', (req, res) => {
  res.send('Rapor Sync API is running.');
});

// Initialize DB then start server
initDB().then(async () => {
    initCronJobs();

    // Auto-run sync on first start if no data exists or if explicitly requested
    const latestData = await getLatestNavTree();
    if (!latestData || process.env.RUN_SYNC_ON_STARTUP === 'true') {
        console.log("First time run detected (or RUN_SYNC_ON_STARTUP is true), starting initial sync...");
        // Run asynchronously so we don't block the server startup
        runSync().catch(err => console.error("Initial sync on startup failed:", err));
    }

    app.listen(port, () => {
        console.log(`Example app listening at http://localhost:${port}`);
    });
}).catch(err => {
    console.error("Failed to initialize database:", err);
});
