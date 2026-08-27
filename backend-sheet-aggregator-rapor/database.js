const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

let db;

async function initDB() {
    const dbPath = process.env.DB_PATH || './database/database.sqlite';
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_name TEXT,
            status TEXT,
            message TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS rapor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nav_tree TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            duration_ms INTEGER,
            logs TEXT,
            api_data TEXT
        );
    `);
    
    console.log('Database initialized.');
}

async function logStep(stepName, status, message) {
    if (!db) return;
    await db.run(
        `INSERT INTO sync_logs (step_name, status, message) VALUES (?, ?, ?)`,
        [stepName, status, message]
    );
}

async function clearLogs() {
    if (!db) return;
    await db.run(`DELETE FROM sync_logs`);
}

async function getLogs() {
    if (!db) return [];
    return await db.all(`SELECT * FROM sync_logs ORDER BY timestamp ASC`);
}

async function startRun() {
    if (!db) return null;
    const result = await db.run(
        `INSERT INTO sync_runs (status, logs) VALUES (?, ?)`,
        ['PENDING', '[]']
    );
    return result.lastID;
}

async function updateRun(id, status, logs, apiData = null, endTime = null, durationMs = null) {
    if (!db) return;
    await db.run(
        `UPDATE sync_runs SET 
            status = coalesce(?, status), 
            logs = coalesce(?, logs), 
            api_data = coalesce(?, api_data), 
            end_time = coalesce(?, end_time), 
            duration_ms = coalesce(?, duration_ms) 
         WHERE id = ?`,
        [status, JSON.stringify(logs), apiData ? JSON.stringify(apiData) : null, endTime, durationMs, id]
    );
}

async function getAllRuns() {
    if (!db) return [];
    const rows = await db.all(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 50`);
    return rows.map(row => {
        try { row.logs = row.logs ? JSON.parse(row.logs) : []; } catch(e) { row.logs = []; }
        try { row.api_data = row.api_data ? JSON.parse(row.api_data) : null; } catch(e) { row.api_data = null; }
        return row;
    });
}

async function saveNavTree(navTreeJson) {
    if (!db) return;
    await db.run(
        `INSERT INTO rapor_data (nav_tree) VALUES (?)`,
        [JSON.stringify(navTreeJson)]
    );
}

async function getLatestNavTree() {
    if (!db) return null;
    const row = await db.get(`SELECT nav_tree FROM rapor_data ORDER BY created_at DESC LIMIT 1`);
    if (row && row.nav_tree) {
        try {
            return JSON.parse(row.nav_tree);
        } catch (e) {
            return null;
        }
    }
    return null;
}

module.exports = {
    initDB,
    logStep,
    clearLogs,
    getLogs,
    saveNavTree,
    getLatestNavTree,
    startRun,
    updateRun,
    getAllRuns
};
