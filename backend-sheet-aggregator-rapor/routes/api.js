const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { clearLogs, getLogs, getLatestNavTree, getAllRuns, getRunsCount, getRunById } = require('../database');
const { runSync } = require('../services/syncService');

// ─── Rate Limiters ──────────────────────────────────────────────────────────

/**
 * Sync limiter: once per 5 minutes per IP.
 * The sync process is heavy (traverses Drive, calls Sheets API, backs up data to Google Drive),
 * so we enforce a strict cooldown to prevent accidental or abusive re-triggers.
 */
const syncLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 1,                   // allow only 1 request per window per IP
    standardHeaders: true,    // return rate limit info in RateLimit-* headers
    legacyHeaders: false,
    message: {
        error: 'Sync request rejected. Please wait 5 minutes between sync requests.',
        retryAfter: '5 minutes',
    },
});

/**
 * General API limiter: 60 requests per minute for status/data endpoints.
 * Prevents polling abuse while still allowing frequent frontend status checks.
 */
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests. Please slow down.',
    },
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// Manually trigger sync process (rate-limited: 1 per 5 minutes)
router.all('/sync', syncLimiter, async (req, res) => {
    try {

        // Spawn async so we don't block the HTTP request.
        // The frontend will poll /status to check on its progress.
        runSync().catch(err => console.error("Unhandled error in runSync:", err));

        res.status(202).json({ message: "Sync process started in the background." });
    } catch (err) {
        console.error("Failed to start sync:", err);
        res.status(500).json({ error: "Failed to start sync process." });
    }
});

// Get the latest populated JSON mapping tree
router.get('/data', async (req, res) => {
    try {
        const tree = await getLatestNavTree();
        if (!tree) {
            return res.status(404).json({ error: "No finalized data found. Run a sync first." });
        }
        res.status(200).json(tree);
    } catch (err) {
        console.error("Failed to fetch data:", err);
        res.status(500).json({ error: "Failed to fetch rapor data." });
    }
});

// Get real-time status of the currently running sync process with pagination & lazy loading
router.get('/status', generalLimiter, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 50);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const includeApiData = req.query.include_api_data === 'true';

        const [runs, total] = await Promise.all([
            getAllRuns({ limit, offset, includeApiData }),
            getRunsCount()
        ]);

        const hasMore = offset + runs.length < total;
        res.set('X-Total-Count', String(total));
        res.set('X-Has-More', String(hasMore));

        if (req.query.format === 'paginated') {
            return res.status(200).json({ runs, total, hasMore, limit, offset });
        }

        // Return array of runs for default backwards-compatibility
        res.status(200).json(runs);
    } catch (err) {
        console.error("Failed to fetch logs:", err);
        res.status(500).json({ error: "Failed to fetch status logs." });
    }
});

// Get a single run's full details (including heavy api_data) on demand
router.get('/runs/:id', generalLimiter, async (req, res) => {
    try {
        const runId = parseInt(req.params.id, 10);
        if (!runId) return res.status(400).json({ error: "Invalid run ID." });

        const run = await getRunById(runId);
        if (!run) return res.status(404).json({ error: "Run not found." });

        res.status(200).json(run);
    } catch (err) {
        console.error("Failed to fetch run:", err);
        res.status(500).json({ error: "Failed to fetch run details." });
    }
});

module.exports = router;
