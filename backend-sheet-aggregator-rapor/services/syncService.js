const { logStep, saveNavTree, startRun, updateRun } = require('../database');
const { 
    getFolderContents, 
    getSpreadsheetMetadata, 
    getSheetValues,
    getOrCreateDateFolder, 
    backupSheetToDrive, 
    backupNavJsonToDrive 
} = require('../integrations/googleApi');

// -----------------------------------------------------------------------
//  Subject name mapping (mirrors the n8n Code node exactly)
// -----------------------------------------------------------------------
const SUBJECT_MAP = {
    'PAI':  'Pendidikan Agama Islam',
    'PP':   'Pendidikan Pancasila',
    'BI':   'Bahasa Indonesia',
    'MTK':  'Matematika',
    'IPAS': 'Ilmu Pengetahuan Alam dan Sosial',
    'PJOK': 'Pendidikan Jasmani Olahraga dan Kesehatan',
    'SBY':  'Seni Budaya',
    'BSU':  'Bahasa Sunda',
    'BING': 'Bahasa Inggris',
    'TIK':  'Teknologi Informasi dan Komunikasi',
    'BAR':  'Bahasa Arab',
    'FQH':  'Fikih',
    'HDS':  'Hadis',
};

// -----------------------------------------------------------------------
//  scanSheetForSubclasses
//  Reads column A of a given sheet and finds rows that contain subclass
//  labels like "1A", "2B", "Kelas 3C", etc.
//
//  Returns: { "1A": 4, "1B": 32, "2A": 115, ... }  (1-based row numbers)
// -----------------------------------------------------------------------
async function scanSheetForSubclasses(gsheetId, sheetTitle) {
    const values = await getSheetValues(gsheetId, `${sheetTitle}!A:A`);
    const result = {};

    values.forEach((row, idx) => {
        const cell = (row[0] || '').toString().trim();
        // Match plain "1A" or prefixed "Kelas 1A" / "KELAS 2B" etc.
        const match = cell.match(/^(?:kelas\s+)?(\d+[A-Z])$/i);
        if (match) {
            const key = match[1].toUpperCase(); // normalise to "1A"
            if (result[key] === undefined) {
                result[key] = idx + 1; // convert 0-based index to 1-based row
            }
        }
    });

    return result;
}

// -----------------------------------------------------------------------
//  buildMapelNode
//  Turns one class spreadsheet ("Nilai Mapel Kelas 1A") into a nav node.
//  Label is derived from the file name by stripping common prefixes.
// -----------------------------------------------------------------------
async function buildMapelNode(spreadsheetFile) {
    const gsheetId = spreadsheetFile.id;

    // "Nilai Mapel Kelas 1A" → "Kelas 1A"
    const label = spreadsheetFile.name
        .replace(/^Nilai\s+Mapel\s+/i, '')
        .replace(/^Nilai\s+/i, '')
        .trim();

    const kelasNode = { label, children: [] };

    const subjectChildren = [];
    const rekapChildren   = [];
    const cetakChildren   = [];
    const coverChildren   = [];
    const biodataChildren = [];

    const sheetsData = await getSpreadsheetMetadata(gsheetId);

    for (const sheet of sheetsData) {
        const sheetName = sheet.title;
        const gid       = sheet.sheetId;
        const valueObj  = JSON.stringify({ gsheetId, gid });
        const upper     = sheetName.toUpperCase();
        const lower     = sheetName.toLowerCase();

        if (SUBJECT_MAP[upper]) {
            subjectChildren.push({ label: SUBJECT_MAP[upper], value: valueObj });

        } else if (lower.startsWith('rekap') || lower.includes('ledger')) {
            // "Rekap STS" → "Ledger STS"
            const suffix = sheetName.replace(/^rekap\s*/i, '').trim();
            rekapChildren.push({ label: suffix ? `Ledger ${suffix}` : 'Ledger', value: valueObj });

        } else if (lower.startsWith('cetak')) {
            cetakChildren.push({ label: sheetName, value: valueObj });

        } else if (lower.startsWith('cover')) {
            coverChildren.push({ label: sheetName, value: valueObj });

        } else if (lower.startsWith('biodata')) {
            biodataChildren.push({ label: sheetName, value: valueObj });
        }
        // Skip: 'setup' and unknown utility sheets
    }

    kelasNode.children.push(...subjectChildren);
    if (rekapChildren.length   > 0) kelasNode.children.push({ label: 'Rekapitulasi', children: rekapChildren });
    if (cetakChildren.length   > 0) kelasNode.children.push({ label: 'Cetak Rapor',  children: cetakChildren });
    if (coverChildren.length   > 0) kelasNode.children.push({ label: 'Cover',        children: coverChildren });
    if (biodataChildren.length > 0) kelasNode.children.push({ label: 'Biodata',      children: biodataChildren });

    return kelasNode;
}

// -----------------------------------------------------------------------
//  buildAdministrasiNode
//  Turns one class administration spreadsheet ("Administrasi Guru Kelas 1A")
//  into a nav node listing all administrative sheets in order.
// -----------------------------------------------------------------------
async function buildAdministrasiNode(spreadsheetFile) {
    const gsheetId = spreadsheetFile.id;

    // "Administrasi Guru Kelas 1A" / "Administrasi Kelas 1A" → "Kelas 1A"
    const label = spreadsheetFile.name
        .replace(/^Administrasi\s+Guru\s+/i, '')
        .replace(/^Administrasi\s+/i, '')
        .replace(/^Nilai\s+/i, '')
        .trim();

    const kelasNode = { label, children: [] };
    const sheetsData = await getSpreadsheetMetadata(gsheetId);

    for (const sheet of sheetsData) {
        const sheetName = sheet.title;
        const lower     = sheetName.toLowerCase().trim();

        // Skip setup or internal configuration sheets
        if (lower === 'setup' || lower === 'config' || lower.startsWith('_')) {
            continue;
        }

        const gid      = sheet.sheetId;
        const valueObj = JSON.stringify({ gsheetId, gid });
        kelasNode.children.push({ label: sheetName, value: valueObj });
    }

    return kelasNode;
}


// -----------------------------------------------------------------------
//  buildEkskulNodes
//  Reads one Ekskul spreadsheet and builds the Kelas > SubKelas tree.
//
//  Strategy:
//   1. Detect Level sheet and Nilai sheet by tab name
//   2. Scan column A of EACH sheet to find subclass label rows
//   3. Per subclass:
//        - found in BOTH  → { valueLevel, valueNilai }
//        - found in Level only → { value }  (using levelGid)
//        - found in Nilai only → { value }  (using nilaiGid, rare edge-case)
//   4. Group children by grade number → Kelas 1, Kelas 2, …
// -----------------------------------------------------------------------
async function buildEkskulNodes(ekskulFile) {
    const gsheetId  = ekskulFile.id;
    const allSheets = await getSpreadsheetMetadata(gsheetId);

    // --- Find Level and Nilai sheet entries --------------------------------
    let levelSheet = null;
    let nilaiSheet = null;

    for (const s of allSheets) {
        const lower = s.title.toLowerCase();
        if (lower.includes('level') && !levelSheet) levelSheet = s;
        else if (lower.includes('nilai') && !nilaiSheet) nilaiSheet = s;
    }

    // Fallback: first non-SETUP sheet becomes Level if no named match
    if (!levelSheet) {
        levelSheet = allSheets.find(s => s.title.toLowerCase() !== 'setup') || null;
    }

    if (!levelSheet) {
        console.warn(`⚠️ No usable Level sheet in "${ekskulFile.name}". Skipping.`);
        return [];
    }

    // Whether ALL subclasses get dual values depends on BOTH tabs being present.
    // If only Level tab exists → all children use simple "value".
    // If both Level AND Nilai tabs exist → all children use "valueLevel" + "valueNilai".
    const hasBothSheets = nilaiSheet !== null;

    // --- Scan each available sheet for subclass row markers ----------------
    console.log(`🔍 Scanning Level sheet "${levelSheet.title}" in ${ekskulFile.name}...`);
    const levelMap = await scanSheetForSubclasses(gsheetId, levelSheet.title);

    let nilaiMap = {};
    if (hasBothSheets) {
        console.log(`🔍 Scanning Nilai sheet "${nilaiSheet.title}" in ${ekskulFile.name}...`);
        nilaiMap = await scanSheetForSubclasses(gsheetId, nilaiSheet.title);
    }

    if (Object.keys(levelMap).length === 0) {
        console.warn(`⚠️ No subclass labels found in Level sheet of "${ekskulFile.name}". Skipping.`);
        return [];
    }

    // --- Build subclass nodes grouped by grade ----------------------------
    // Primary source is the Level sheet. Nilai sheet provides its own row map
    // (rows may differ between tabs, so each tab is scanned independently).
    const classGroups = {}; // { "1": [ node, … ], "2": [ … ] }

    const sortedSubs = Object.keys(levelMap).sort((a, b) =>
        a.localeCompare(b, 'id', { numeric: true })
    );

    for (const sub of sortedSubs) {
        const grade    = sub.charAt(0);
        if (!classGroups[grade]) classGroups[grade] = [];

        let node;
        if (hasBothSheets) {
            // Use the row found in each respective sheet.
            // If a subclass is missing from Nilai sheet, fall back to Level row.
            const nilaiRow = nilaiMap[sub] ?? levelMap[sub];

            node = {
                label:      sub,
                valueLevel: JSON.stringify({ gsheetId, gid: levelSheet.sheetId, range: `A${levelMap[sub]}` }),
                valueNilai: JSON.stringify({ gsheetId, gid: nilaiSheet.sheetId, range: `A${nilaiRow}` }),
            };
        } else {
            node = {
                label: sub,
                value: JSON.stringify({ gsheetId, gid: levelSheet.sheetId, range: `A${levelMap[sub]}` }),
            };
        }

        classGroups[grade].push(node);
    }

    // --- Build Kelas group nodes -------------------------------------------
    const nodes        = [];
    const sortedGrades = Object.keys(classGroups).sort((a, b) => Number(a) - Number(b));

    for (const grade of sortedGrades) {
        nodes.push({
            label:    `Kelas ${grade}`,
            value:    JSON.stringify({ gsheetId, gid: levelSheet.sheetId }),
            children: classGroups[grade],
        });
    }

    return nodes;
}

// -----------------------------------------------------------------------
//  runSync  –  Main orchestration
// -----------------------------------------------------------------------
async function runSync() {
    let currentLogs = [];
    let finalJson = null;
    let runId = null;
    const startTime = Date.now();

    try {
        runId = await startRun();
    } catch(e) { console.error("Could not start run in DB:", e); }

    const addLog = async (step_name, status, message) => {
        try { await logStep(step_name, status, message); } catch(e) {}
        currentLogs.push({ step_name, status, message, timestamp: new Date().toISOString() });
        if (runId) {
            try { await updateRun(runId, 'PENDING', currentLogs); } catch(e) {}
        }
    };

    try {
        await addLog('SYNC_START', 'PENDING', 'Started the synchronization process.');

        const rootFolderId = process.env.ROOT_DRIVE_FOLDER;
        if (!rootFolderId) throw new Error('ROOT_DRIVE_FOLDER is not set in .env');

        await addLog('DRIVE_TRAVERSAL', 'PENDING', 'Traversing Google Drive folders...');

        const tahunAjaranFolders = await getFolderContents(rootFolderId);
        const finalData          = [];
        const processedSheets    = [];

        for (const ta of tahunAjaranFolders) {
            if (ta.mimeType !== 'application/vnd.google-apps.folder') continue;

            const taContents = await getFolderContents(ta.id);

            // ── 1. Check for standalone spreadsheets directly in Tahun Ajaran folder ──
            const standaloneSpreadsheets = [];
            for (const item of taContents) {
                if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
                    standaloneSpreadsheets.push({
                        label: item.name,
                        value: JSON.stringify({ gsheetId: item.id, gid: 0 })
                    });
                    processedSheets.push({ id: item.id, name: item.name });
                }
            }

            // ── 2. Process Administrasi folder if present ──────────────────────────────
            const adminFolder = taContents.find(item => 
                item.mimeType === 'application/vnd.google-apps.folder' &&
                item.name.toLowerCase().includes('administrasi')
            );

            if (adminFolder) {
                await addLog('PROCESS_ADMINISTRASI', 'PENDING',
                    `Processing Administrasi folder in ${ta.name}...`);
                
                const adminContents = await getFolderContents(adminFolder.id);

                const administrasiData = {
                    tahunAjaran: ta.name,
                    semester:    0,
                    type:        'administrasi',
                    label:       'Administrasi (1 Tahun)',
                    data: { dataMapel: [], dataEkskul: [], dataStandalone: [...standaloneSpreadsheets] },
                };

                for (const item of adminContents) {
                    if (item.mimeType === 'application/vnd.google-apps.folder') {
                        // Grade folder, e.g. "Kelas 1"
                        const classFiles = await getFolderContents(item.id);
                        classFiles.sort((a, b) => a.name.localeCompare(b.name));

                        for (const cf of classFiles) {
                            if (cf.mimeType !== 'application/vnd.google-apps.spreadsheet') continue;

                            processedSheets.push({ id: cf.id, name: cf.name });
                            try {
                                administrasiData.data.dataMapel.push(await buildAdministrasiNode(cf));
                                await addLog('PROCESS_ADMINISTRASI_SUCCESS', 'SUCCESS', `Successfully read Administrasi "${cf.name}"`);
                            } catch (e) {
                                console.error(`❌ Administrasi "${cf.name}" failed:`, e.message);
                                await addLog('PROCESS_ADMINISTRASI_ERROR', 'ERROR', `Failed reading Administrasi "${cf.name}": ${e.message}`);
                                throw e;
                            }
                        }
                    } else if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
                        processedSheets.push({ id: item.id, name: item.name });
                        try {
                            administrasiData.data.dataMapel.push(await buildAdministrasiNode(item));
                            await addLog('PROCESS_ADMINISTRASI_SUCCESS', 'SUCCESS', `Successfully read Administrasi "${item.name}"`);
                        } catch (e) {
                            console.error(`❌ Administrasi "${item.name}" failed:`, e.message);
                            await addLog('PROCESS_ADMINISTRASI_ERROR', 'ERROR', `Failed reading Administrasi "${item.name}": ${e.message}`);
                            throw e;
                        }
                    }
                }

                // Sort classes in Administrasi
                administrasiData.data.dataMapel.sort((a, b) =>
                    a.label.localeCompare(b.label, 'id', { numeric: true })
                );

                finalData.push(administrasiData);
            }

            // ── 3. Process Semester folders (Semester 1, Semester 2) ───────────────────
            const semesterFolders = taContents.filter(item =>
                item.mimeType === 'application/vnd.google-apps.folder' &&
                !item.name.toLowerCase().includes('administrasi')
            );
            semesterFolders.sort((a, b) => a.name.localeCompare(b.name));

            for (const sem of semesterFolders) {
                const semMatch    = sem.name.match(/\d+/);
                const semesterNum = semMatch ? parseInt(semMatch[0], 10) : 1;

                const semesterData = {
                    tahunAjaran: ta.name,
                    semester:    semesterNum,
                    type:        'semester',
                    label:       `Semester ${semesterNum}`,
                    data: { dataMapel: [], dataEkskul: [], dataStandalone: [...standaloneSpreadsheets] },
                };

                const semesterContents = await getFolderContents(sem.id);

                for (const item of semesterContents) {
                    const nameLower = item.name.toLowerCase();

                    // ── EKSKUL: spreadsheets whose name contains "eks" ──────
                    if (
                        item.mimeType === 'application/vnd.google-apps.spreadsheet' &&
                        (nameLower.includes('ekskul') ||
                         nameLower.includes('ekstrakurikuler') ||
                         nameLower.startsWith('eks'))
                    ) {
                        await addLog('PROCESS_EKSKUL', 'PENDING',
                            `Processing Ekskul: ${item.name} (${ta.name} Sem ${semesterNum})`);

                        processedSheets.push({ id: item.id, name: item.name });

                        try {
                            const ekskulNodes = await buildEkskulNodes(item);
                            semesterData.data.dataEkskul.push(...ekskulNodes);
                            await addLog('PROCESS_EKSKUL_SUCCESS', 'SUCCESS', `Successfully read spreadsheet "${item.name}"`);
                        } catch (e) {
                            console.error(`❌ Ekskul "${item.name}" failed:`, e.message);
                            await addLog('PROCESS_EKSKUL_ERROR', 'ERROR', `Failed reading spreadsheet "${item.name}": ${e.message}`);
                            throw e; // Re-throw to fail the entire sync
                        }

                    // ── CLASS FOLDER: contains per-class spreadsheets ───────
                    } else if (item.mimeType === 'application/vnd.google-apps.folder') {
                        await addLog('PROCESS_MAPEL', 'PENDING',
                            `Processing class folder: ${item.name} (${ta.name} Sem ${semesterNum})`);

                        const classFiles = await getFolderContents(item.id);
                        // Sort alphabetically so order is 1A, 1B, 1C …
                        classFiles.sort((a, b) => a.name.localeCompare(b.name));

                        for (const cf of classFiles) {
                            if (cf.mimeType !== 'application/vnd.google-apps.spreadsheet') continue;
                            // Skip any Ekskul file that happens to live inside a folder
                            if (cf.name.toLowerCase().includes('eks')) continue;

                            processedSheets.push({ id: cf.id, name: cf.name });
                            try {
                                semesterData.data.dataMapel.push(await buildMapelNode(cf));
                                await addLog('PROCESS_MAPEL_SUCCESS', 'SUCCESS', `Successfully read spreadsheet "${cf.name}"`);
                            } catch (e) {
                                console.error(`❌ Mapel "${cf.name}" failed:`, e.message);
                                await addLog('PROCESS_MAPEL_ERROR', 'ERROR', `Failed reading spreadsheet "${cf.name}": ${e.message}`);
                                throw e; // Re-throw to fail the entire sync
                            }
                        }

                    // ── CLASS SPREADSHEET directly in Semester folder ───────
                    // (Handles flat Drive structure without group sub-folders)
                    } else if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
                        await addLog('PROCESS_MAPEL', 'PENDING',
                            `Processing class spreadsheet: ${item.name}`);

                        processedSheets.push({ id: item.id, name: item.name });
                        try {
                            semesterData.data.dataMapel.push(await buildMapelNode(item));
                            await addLog('PROCESS_MAPEL_SUCCESS', 'SUCCESS', `Successfully read spreadsheet "${item.name}"`);
                        } catch (e) {
                            console.error(`❌ Mapel "${item.name}" failed:`, e.message);
                            await addLog('PROCESS_MAPEL_ERROR', 'ERROR', `Failed reading spreadsheet "${item.name}": ${e.message}`);
                            throw e; // Re-throw to fail the entire sync
                        }
                    }
                }

                // Sort dataMapel by label ("Kelas 1A" < "Kelas 1B" < "Kelas 2A" …)
                semesterData.data.dataMapel.sort((a, b) =>
                    a.label.localeCompare(b.label, 'id', { numeric: true })
                );

                finalData.push(semesterData);
            }
        }

        finalJson = { title: 'Rapor SD', data: finalData };

        await addLog('DB_SAVE', 'PENDING', 'Saving nav tree to database.');
        await saveNavTree(finalJson);

        // ── BACKUP ──────────────────────────────────────────────────────────
        try {
            const backupFolderId = process.env.BACKUP_DRIVE_FOLDER;
            if (backupFolderId) {
                await addLog('BACKUP_START', 'PENDING', 'Starting Google Drive backup...');
                const dateFolderId = await getOrCreateDateFolder(backupFolderId);

                console.log(`📦 Copying ${processedSheets.length} sheets to backup folder...`);
                await Promise.all(
                    processedSheets.map(s => backupSheetToDrive(s.id, s.name, dateFolderId))
                );
                await backupNavJsonToDrive(finalJson, dateFolderId);

                await addLog('BACKUP_COMPLETE', 'SUCCESS', 'Backup finished.');
            } else {
                console.warn('⚠️ BACKUP_DRIVE_FOLDER not set. Skipping backup.');
            }
        } catch (backupErr) {
            console.error('❌ Backup failed:', backupErr);
            await addLog('BACKUP_ERROR', 'ERROR', backupErr.message);
        }

        await addLog('SYNC_COMPLETE', 'SUCCESS', 'Synchronization finished successfully.');
        
        if (runId) {
            const end = Date.now();
            await updateRun(runId, 'SUCCESS', currentLogs, finalJson, new Date().toISOString(), end - startTime);
        }

    } catch (error) {
        console.error('Sync process failed:', error);
        await addLog('SYNC_ERROR', 'ERROR', error.message);
        if (runId) {
            const end = Date.now();
            await updateRun(runId, 'ERROR', currentLogs, finalJson, new Date().toISOString(), end - startTime);
        }
    }
}

module.exports = { runSync };
