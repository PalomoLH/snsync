const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const chokidar = require('chokidar');
const express = require('express');
const open = require('open');
const crypto = require('crypto');
const readline = require('readline');

// --- ENVIRONMENT PREPARATION (Allows running from root by specifying the project) ---
// Checks if --project "path/to/folder" was passed
const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
if (projectIdx !== -1 && args[projectIdx + 1]) {
    const targetProject = args[projectIdx + 1];
    if (fs.existsSync(targetProject)) {
        process.chdir(targetProject); // Changes execution directory to the project folder
    }
}

// --- CONTEXT LOGIC ---
// Where was the command run? (e.g., /Users/user/workspace/sn/projects/client_A)
let CURRENT_DIR = process.cwd(); 

// AUTO-FIX: If the script runs inside /src or subfolders
// Tries to go up the directory tree until it finds .env or sn-config.json
const MAX_LEVELS = 5;
for (let i = 0; i < MAX_LEVELS; i++) {
    if (fs.existsSync(path.join(CURRENT_DIR, '.env'))) {
        break; // Found the root!
    }
    const parent = path.dirname(CURRENT_DIR);
    if (parent === CURRENT_DIR) break; // Reached system root
    CURRENT_DIR = parent;
}
// Adjusts the process to run in the correct root
if (process.cwd() !== CURRENT_DIR) {
    process.chdir(CURRENT_DIR);
}

// Looks for .env in the folder WHERE YOU ARE, not where the script is
const envPath = path.join(CURRENT_DIR, '.env');

if (!fs.existsSync(envPath)) {
    console.error(`❌ ERROR: .env file not found in: ${CURRENT_DIR}`);
    console.error(`   Make sure you are inside the client project folder.`);
    process.exit(1);
}

// Loads local .env variables
require('dotenv').config({ path: envPath });

// --- EXTRA ENVIRONMENT VARIABLES (ZSH) ---
const SN_ENC_SECRET = process.env.SN_ENC_SECRET; // Secret to encrypt the token at rest

// --- ENCRYPTION HELPERS ---
function encryptData(data) {
    const text = JSON.stringify(data);
    if (!SN_ENC_SECRET) return text; // If no password, save as pure JSON

    const key = crypto.createHash('sha256').update(SN_ENC_SECRET).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    // Format: iv:content
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(text) {
    if (!SN_ENC_SECRET) return JSON.parse(text);

    // If file is pure JSON but we have password, try to read as JSON (migration)
    if (text.trim().startsWith('{')) return JSON.parse(text);

    const parts = text.split(':');
    if (parts.length !== 2) throw new Error('Invalid cache format or encrypted with different key.');

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const key = crypto.createHash('sha256').update(SN_ENC_SECRET).digest();
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
}

function saveTokenCache(data) {
    const content = encryptData(data);
    fs.writeFileSync(CONFIG.tokenCache, content, { encoding: 'utf8', mode: 0o600 });
}

function loadTokenCache() {
    const content = fs.readFileSync(CONFIG.tokenCache, 'utf8');
    return decryptData(content);
}

// Visual confirmation of where we are connecting
console.log(`🔌 Connecting to: ${process.env.SN_INSTANCE}`);
console.log(`📂 Project Folder: ${CURRENT_DIR}`);

// --- AUTH CONFIGURATION (Hybrid: Basic or OAuth Browser) ---
// If CLIENT_ID exists but NO PASSWORD in .env, assume Browser Auth
const USE_BROWSER_AUTH = process.env.SN_CLIENT_ID && !process.env.SN_PASSWORD;
const AUTH_MODE = USE_BROWSER_AUTH ? 'OAUTH_BROWSER' : (process.env.SN_USER ? 'BASIC' : 'UNKNOWN');

console.log(`🔐 Authentication Mode: ${AUTH_MODE}`);

const CONFIG = {
    url: process.env.SN_INSTANCE,
    basicAuth: { username: process.env.SN_USER, password: process.env.SN_PASSWORD },
    oauth: { 
        clientId: process.env.SN_CLIENT_ID, 
        clientSecret: process.env.SN_CLIENT_SECRET,
        tokenUrl: `${process.env.SN_INSTANCE}/oauth_token.do`,
        authUrl: `${process.env.SN_INSTANCE}/oauth_auth.do`,
        redirectUri: 'http://localhost:3000/callback'
    },
    localFolder: path.join(CURRENT_DIR, 'src'),
    tokenCache: path.join(CURRENT_DIR, '.token_cache.json'),
    mapping: loadMappingConfig()
};

// --- FUNCTION: BROWSER LOGIN (Local Server) ---
async function startBrowserLogin() {
    return new Promise((resolve, reject) => {
        const app = express();
        let server;
        
        console.log('🌍 Starting local authentication server...');
        
        app.get('/callback', async (req, res) => {
            const code = req.query.code;
            if (code) {
                res.send('<h1>Login successful!</h1><p>You can close this window and return to the terminal.</p>');
                try {
                    console.log('🔑 Authorization code received! Exchanging for token...');
                    const params = new URLSearchParams();
                    params.append('grant_type', 'authorization_code');
                    params.append('client_id', CONFIG.oauth.clientId);
                    params.append('client_secret', CONFIG.oauth.clientSecret);
                    params.append('code', code);
                    params.append('redirect_uri', CONFIG.oauth.redirectUri);

                    const tokenRes = await axios.post(CONFIG.oauth.tokenUrl, params);
                    const tokenData = tokenRes.data;
                    
                    // Save to cache with timestamp
                    tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
                    tokenData.last_used_at = Date.now(); // Starts inactivity counter
                    
                    try {
                        saveTokenCache(tokenData);
                        console.log('💾 Tokens saved (🔐 ENCRYPTED) to .token_cache.json');
                    } catch (saveErr) {
                         console.error('❌ Error saving cache:', saveErr.message);
                    }
                    
                    resolve(tokenData.access_token);
                } catch (e) {
                    console.error('❌ Token exchange error:', e.response?.data || e.message);
                    reject(e);
                } finally {
                    server.close();
                }
            } else {
                res.status(400).send('Error: Code not received.');
                reject(new Error('No code received'));
                server.close();
            }
        });

        server = app.listen(3000, async () => {
            const authUrl = `${CONFIG.oauth.authUrl}?response_type=code&client_id=${CONFIG.oauth.clientId}&redirect_uri=${encodeURIComponent(CONFIG.oauth.redirectUri)}`;
            console.log(`🚀 Opening browser for login: ${authUrl}`);
            await open(authUrl);
        });
    });
}

// --- SMART HTTP CLIENT ---
const snClient = axios.create({ baseURL: CONFIG.url });

async function getValidToken() {
    // 1. Try to load from cache
    if (fs.existsSync(CONFIG.tokenCache)) {
        try {
            const tokenData = loadTokenCache();
            
            // --- SECURITY CHECK: INACTIVITY TIMEOUT ---
            const IDLE_TIMEOUT = 20 * 60 * 1000; // 20 minutes
            if (tokenData.last_used_at && (Date.now() - tokenData.last_used_at > IDLE_TIMEOUT)) {
                console.warn('\n🔒 Session expired due to inactivity (+20min).');
                console.warn('   For security, please login again.');
                fs.removeSync(CONFIG.tokenCache); 
                // Force fall through to login flow below
                throw new Error("Session timed out due to inactivity");
            }

            // Updates "last used" timestamp (sliding window effect)
            // Only saves if more than 10s passed since last update to save disk I/O
            if (!tokenData.last_used_at || (Date.now() - tokenData.last_used_at > 10000)) {
                tokenData.last_used_at = Date.now();
                saveTokenCache(tokenData);
            }

            // 60s security buffer
            if (Date.now() < tokenData.expires_at - 60000) {
                return tokenData.access_token;
            }
            console.log('⚠️ Token expired or expiring soon. Attempting refresh...');
            if (tokenData.refresh_token) {
                const params = new URLSearchParams();
                params.append('grant_type', 'refresh_token');
                params.append('client_id', CONFIG.oauth.clientId);
                params.append('client_secret', CONFIG.oauth.clientSecret);
                params.append('refresh_token', tokenData.refresh_token);
                
                const refreshRes = await axios.post(CONFIG.oauth.tokenUrl, params);
                const newTokenData = refreshRes.data;
                newTokenData.expires_at = Date.now() + (newTokenData.expires_in * 1000);
                newTokenData.last_used_at = Date.now(); // Reset timer on refresh too

                // Preserve old refresh token if new one is not returned
                if (!newTokenData.refresh_token) newTokenData.refresh_token = tokenData.refresh_token;
                
                saveTokenCache(newTokenData);
                console.log('✅ Token refreshed (and re-encrypted) successfully!');
                return newTokenData.access_token;
            }
        } catch (e) {
            // Only log if not the inactivity error we just generated
            if(e.message !== "Session timed out due to inactivity") {
                console.warn('⚠️ Error reading/refreshing cache:', e.message);
            }
            // If failed (e.g., wrong password), will fall through to browser login below
        }
    }

    // 2. If everything failed, start browser login
    if (AUTH_MODE === 'OAUTH_BROWSER') {
        return await startBrowserLogin();
    } else {
        throw new Error("Traditional OAUTH mode failed or not configured correctly.");
    }
}

snClient.interceptors.request.use(async (reqConfig) => {
    if (AUTH_MODE === 'OAUTH_BROWSER') {
        const token = await getValidToken();
        reqConfig.headers['Authorization'] = `Bearer ${token}`;
    } else if (AUTH_MODE === 'BASIC') {
        reqConfig.auth = CONFIG.basicAuth;
    }
    return reqConfig;
});

// No complex retry interceptor needed, the preventive logic above solves it
function loadMappingConfig() {
    const configPath = path.join(CURRENT_DIR, 'sn-config.json');
    if (fs.existsSync(configPath)) {
        console.log('⚙️  Loading sn-config.json from project...');
        const loaded = fs.readJsonSync(configPath);
        return loaded.mapping || loaded;
    }
    
    // Empty default fallback (Force use of sn-config.json)
    console.warn('⚠️  WARNING: No sn-config.json found in this folder!');
    console.warn('   Create a sn-config.json file to define which tables to sync.');
    return {};
}

// --- FUNCTIONS ---

async function pullFromServiceNow(options = {}) {
    console.log('⬇️  Starting Smart Download...');
    
    let targets = Object.entries(CONFIG.mapping);

    // Filter by specific table (--table)
    if (options.table) {
        if (CONFIG.mapping[options.table]) {
            targets = [[options.table, CONFIG.mapping[options.table]]];
            console.log(`🎯 Focusing only on table: ${options.table}`);
        } else {
            console.error(`❌ Error: Table '${options.table}' not found in sn-config.json.`);
            return;
        }
    }

    for (const [table, config] of targets) {
        // Query Overlay (--query) - Only applies if it's a specific table or user knows what they are doing
        // If --query is passed without --table, applies to ALL (can be dangerous, but flexible)
        const activeFilter = options.query ? options.query : config.filter;

        console.log(`   Searching in [${table}] with filter: "${activeFilter}"...`);
        
        // 0. NEW LOGIC: Save Context (Schema) ONLY ONCE
        if (config.saveContext || config.onlyContext) {
            const missingRefs = await captureTableSchema(table, activeFilter);
            
            // Context Interactive Suggestion (Auto-Import)
            if (missingRefs && missingRefs.length > 0 && process.stdout.isTTY) {
                await processMissingRefs(missingRefs);
            }
        }

        // If ONLY Context, skip file download
        if (config.onlyContext) {
            console.log(`      ⏭️  onlyContext mode active for ${table}. Skipping file download.`);
            continue;
        }

        // 1. FILE Download (Now light and fast)
        // We always limit fields to save bandwidth, since context is saved separately
        // Added sys_updated_on for conflict check
        
        // --- FEATURE: JSON Metadata & AI Context Support ---
        // Support 'jsonExport' (from user config) or 'jsonFields'
        const jsonExportFields = config.jsonExport || config.jsonFields || [];
        const hasJsonFields = jsonExportFields.length > 0;
        const displayValueMode = hasJsonFields ? 'all' : 'false';
        
        let fetchFields = ['sys_id', 'sys_updated_on', 'name', 'u_name', 'short_description', ...(config.fields || [])];
        if (hasJsonFields) fetchFields.push(...jsonExportFields);
        if (config.contextKeys) fetchFields.push(...config.contextKeys); // Future proofing

        fetchFields = [...new Set(fetchFields)]; // Unique

        const fieldsParam = `&sysparm_fields=${fetchFields.join(',')}&sysparm_display_value=${displayValueMode}`;
        const queryParam = activeFilter ? `&sysparm_query=${encodeURIComponent(activeFilter)}` : '';
        
        try {
            const url = `/api/now/table/${table}?sysparm_limit=100${queryParam}${fieldsParam}`;
            const response = await snClient.get(url);
            const records = response.data.result;

            if (!records || records.length === 0) {
                console.log(`   ⚠️ No records found for ${table}.`);
                continue;
            }

            // --- INTERACTIVE: Ask for AI Context (Custom Pull Only) ---
            let contextTags = [];
            if (options.query && process.stdout.isTTY) {
                console.log(`\n   🤖 Custom Pull detected for ${records.length} records.`);
                const wantContext = await askQuestion('      Do you want to add/update AI Context tags for these records? (y/N): ');
                if (wantContext.toLowerCase().startsWith('y')) {
                    const tagInput = await askQuestion('      Enter context tag(s) (comma separated, e.g. "Hackathon,Auth"): ');
                    contextTags = tagInput.split(',').map(t => t.trim()).filter(t => t);
                }
            }

            // Helper to get raw value regardless of display_value mode
            const getVal = (r, f) => {
                const val = r[f];
                if (val && typeof val === 'object' && 'value' in val) return val.value;
                return val;
            };

            for (const rec of records) {
                const sysId = getVal(rec, 'sys_id');
                const nameKey = getVal(rec, 'name') || getVal(rec, 'u_name') || getVal(rec, 'short_description') || 'Record';
                let safeName = nameKey.replace(/[^a-z0-9_-]/gi, '_');
                
                // --- NEW FOLDER LOGIC PER RECORD ---
                // Check name conflict
                let recordDir = path.join(CONFIG.localFolder, table, safeName);
                const sysIdFile = path.join(recordDir, '.sys_id');
                
                // If folder exists but is from ANOTHER sys_id, we need to rename current one to avoid conflict
                if (fs.existsSync(recordDir) && fs.existsSync(sysIdFile)) {
                   const existingSysId = fs.readFileSync(sysIdFile, 'utf8').trim();
                   if (existingSysId !== sysId) {
                       // Name conflict! Add sys_id chunk to folder name
                       safeName = `${safeName}_${sysId.substring(0,5)}`;
                       recordDir = path.join(CONFIG.localFolder, table, safeName);
                   }
                }

                // Create record folder
                fs.ensureDirSync(recordDir);
                
                // Save hidden .sys_id so Push knows who this record is
                fs.outputFileSync(path.join(recordDir, '.sys_id'), sysId);
                
                // Save hidden .sys_updated_on for Overwrite Protection
                const updatedOn = getVal(rec, 'sys_updated_on');
                if (updatedOn) {
                    fs.outputFileSync(path.join(recordDir, '.sys_updated_on'), updatedOn);
                }

                // Save field files (e.g., script.js, template.html)
                if (config.fields) {
                    config.fields.forEach(field => {
                        const val = getVal(rec, field);
                        if (val) {
                            const extension = config.ext ? config.ext[field] : 'txt';
                            const fileName = `${field}.${extension}`; // Clean name: script.js
                            const filePath = path.join(recordDir, fileName);
                            fs.outputFileSync(filePath, val);
                        }
                    });
                }

                // --- FEATURE: Extra JSON Metadata ---
                if (hasJsonFields) {
                    const jsonContent = {};
                    jsonExportFields.forEach(f => {
                         // If mode is 'all', rec[f] is usually { value, display_value }
                         // We want to save exactly that structure as per user request
                         jsonContent[f] = rec[f]; 
                    });
                    // Also include name/type if available
                    if (rec['name']) jsonContent['name'] = rec['name'];
                    if (rec['sys_name']) jsonContent['sys_name'] = rec['sys_name'];
                    
                    // User requested "_properties.json", but we should be generic.
                    // If it's sys_properties, use _properties.json, else _record.json
                    const jsonName = table === 'sys_properties' ? '_properties.json' : '_record.json';
                    fs.writeJsonSync(path.join(recordDir, jsonName), jsonContent, { spaces: 4 });
                }

                // --- FEATURE: AI Context File ---
                if (contextTags.length > 0) {
                    const contextFile = path.join(recordDir, '_ai_context.md');
                    let currentContent = '';
                    if (fs.existsSync(contextFile)) {
                        currentContent = fs.readFileSync(contextFile, 'utf8');
                    } else {
                        currentContent = `# AI Context: ${nameKey}\n\n> **Auto-generated context**\n\n`;
                    }

                    // Append new tags if not present
                    const lines = currentContent.split('\n');
                    let tagsToAdd = [...contextTags];
                    
                    // Simple check if tag exists in file
                    tagsToAdd = tagsToAdd.filter(tag => !currentContent.includes(tag));

                    if (tagsToAdd.length > 0) {
                         const newTagsBlock = tagsToAdd.map(t => `- **Context**: ${t}`).join('\n');
                         currentContent += `\n${newTagsBlock}\n`;
                         fs.writeFileSync(contextFile, currentContent);
                         console.log(`      🧠 Added context tags to ${safeName}`);
                    }
                }
            }
            console.log(`   ✅ ${table}: ${records.length} records downloaded/updated.`);
            
        } catch (error) {
            console.error(`   ❌ Error in ${table}:`, error.message);
            if (error.response) console.error(error.response.data);
        }
    }
}


// --- HELPER: USER INTERACTION ---
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function processMissingRefs(missingRefs) {
    console.log(`\n      🤔 Found ${missingRefs.length} referenced tables without context:`);
    missingRefs.forEach(ref => console.log(`         - ${ref}`));
    
    // Check if we are interactive
    if (!process.stdout.isTTY) {
        return;
    }

    const ans = await askQuestion('      ❓ Add their context to sn-config.json? (y/n/select): ');
    
    let toAdd = [];
    if (ans.toLowerCase() === 's' || ans.toLowerCase() === 'y') {
        toAdd = missingRefs;
    } else if (ans.toLowerCase() === 'select') {
        const selected = await askQuestion('      ✍️  Enter tables separated by comma (e.g., sys_user, cmn_location): ');
        toAdd = selected.split(',').map(s => s.trim()).filter(s => missingRefs.includes(s));
    }

    if (toAdd.length > 0) {
        console.log(`      ⚙️  Adding [${toAdd.join(', ')}] to sn-config.json...`);
        
        // Load, Edit and Save JSON
        const configPath = path.join(CURRENT_DIR, 'sn-config.json');
        const currentConfig = fs.readJsonSync(configPath);
        
        // Ensure structure
        if (!currentConfig.mapping) currentConfig.mapping = {};

        for (const newTable of toAdd) {
            if (!currentConfig.mapping[newTable]) {
                currentConfig.mapping[newTable] = {
                    onlyContext: true,
                    filter: "sys_idISNOTEMPTY" // Safe default filter
                };
                // Update local memory for this run too
                CONFIG.mapping[newTable] = currentConfig.mapping[newTable];
            }
        }
        
        fs.writeJsonSync(configPath, currentConfig, { spaces: 4 });
        console.log(`      ✅ Configuration updated! Downloading contexts now...`);
        
        // Download context immediately for new tables
        for (const newTable of toAdd) {
            await captureTableSchema(newTable, "sys_idISNOTEMPTY");
        }
    }
}

// --- INTEGRATION: ADVANCED SCHEMA CAPTURE ---
async function captureTableSchema(table, activeFilter) {
    let missingRefs = []; 
    try {
        console.log(`      🧠 Generating Smart Context (Schema + Choices + Refs) for ${table}...`);
        
        const schemaData = {
            _meta: { timestamp: new Date(), source: 'sn-sync v2' },
            columns: [],
            number_prefix: '',
            sample_data: {}
        };

        // 1. Dictionary (Fields, Types, Labels)
        // Get display=true to know which is the default Display Value of the table
        const dictUrl = `/api/now/table/sys_dictionary?sysparm_query=name=${table}^active=true&sysparm_fields=element,column_label,internal_type,reference,choice,display&sysparm_limit=500`;
        const dictRes = await snClient.get(dictUrl);
        const dictEntries = dictRes.data.result || [];

        // 2. Choices (Option lists) - Only for choice fields
        const choiceFields = dictEntries.filter(d => d.choice === '1').map(d => d.element);
        let choicesMap = {};
        if (choiceFields.length > 0) {
             const choiceUrl = `/api/now/table/sys_choice?sysparm_query=name=${table}^elementIN${choiceFields.join(',')}^inactive=false&sysparm_fields=element,label,value,sequence`;
             try {
                 const choiceRes = await snClient.get(choiceUrl);
                 (choiceRes.data.result || []).forEach(c => {
                     if (!choicesMap[c.element]) choicesMap[c.element] = [];
                     choicesMap[c.element].push({ label: c.label, value: c.value });
                 });
             } catch (e) {
                 console.warn('      ⚠️ Failed to fetch choices (might be missing ACL):', e.message);
             }
        }

        // 3. Number Prefix (sys_number)
        try {
            const numRes = await snClient.get(`/api/now/table/sys_number?sysparm_query=category=${table}&sysparm_fields=prefix&sysparm_limit=1`);
            if (numRes.data.result && numRes.data.result.length > 0) {
                schemaData.number_prefix = numRes.data.result[0].prefix;
            }
        } catch (ignored) {}

        // 4. Schema Assembly
        
        schemaData.columns = dictEntries.map(d => {
            const col = {
                name: d.element,
                label: d.column_label,
                type: d.internal_type?.value || d.internal_type,
                reference: d.reference?.value || d.reference,
                is_display: d.display === 'true'
            };

            // Add choices if any
            if (choicesMap[col.name]) {
                col.choices = choicesMap[col.name];
            }

            // Missing Reference Check (Auto-Discovery Suggestion)
            if (col.reference && col.reference !== table) { // Ignore self-ref
                // If referenced table is NOT in our config, suggest
                if (!CONFIG.mapping[col.reference]) {
                    if (!missingRefs.includes(col.reference)) missingRefs.push(col.reference);
                }
            }

            return col;
        });

        // 5. Sample Data (1 real record - Sanitized/Fictional for Privacy)
        const queryParam = activeFilter ? `&sysparm_query=${encodeURIComponent(activeFilter)}` : '';
        // sysparm_display_value=all gives us value + display value, good for context
        const sampleUrl = `/api/now/table/${table}?sysparm_limit=1&sysparm_display_value=all${queryParam}`; 
        const sampleRes = await snClient.get(sampleUrl);
        if (sampleRes.data.result && sampleRes.data.result.length > 0) {
            const raw = sampleRes.data.result[0];
            const sanitized = {};
            
            for (const [k, v] of Object.entries(raw)) {
                // Simple case: null
                if (v === null) {
                    sanitized[k] = null;
                    continue;
                }

                // Checks if it's the standard object from display_value=all
                const isComplex = (typeof v === 'object' && ('value' in v || 'display_value' in v));
                
                // Determine dummy values based on field name to keep typing without leaking data
                let dummyVal = "SAMPLE_VALUE";
                let dummyDisp = "Sample Display Value";
                
                if (k === 'sys_id') {
                    dummyVal = "00000000000000000000000000000000";
                    dummyDisp = "00000000000000000000000000000000";
                } else if (k.includes('date') || k.includes('_on') || k.includes('_at')) {
                    dummyVal = "2025-01-01 12:00:00";
                    dummyDisp = "2025-01-01 12:00:00";
                } else if (k.includes('count') || k === 'order' || k === 'sequence') {
                    dummyVal = "1";
                    dummyDisp = "1";
                } else if (typeof v === 'boolean' || v === 'true' || v === 'false') {
                    dummyVal = "true";
                    dummyDisp = "true";
                }

                if (isComplex) {
                    sanitized[k] = {
                        display_value: dummyDisp,
                        value: v.link ? "REF_SYS_ID_HASH" : dummyVal
                    };
                    if (v.link) {
                        // Keeps base URL but kills real ID
                        sanitized[k].link = v.link.replace(/[a-f0-9]{32}/gi, 'REF_SYS_ID_HASH');
                    }
                } else {
                    sanitized[k] = dummyVal;
                }
            }
            schemaData.sample_data = sanitized;
        }

        // Save JSON
        const schemaPath = path.join(CONFIG.localFolder, table, '.ai_context', `_schema.${table}.json`);
        fs.outputFileSync(schemaPath, JSON.stringify(schemaData, null, 2));
        console.log(`      📘 Context Saved. Prefix: [${schemaData.number_prefix}] Columns: ${schemaData.columns.length}`);
        
        // Return missing references for caller to decide what to do
        return missingRefs;

    } catch (e) {
        console.warn(`      ⚠️  Error generating advanced context: ${e.message}`);
        return [];
    }
}

async function createRecordInServiceNow(folderPath, table) {
    const recordName = path.basename(folderPath);
    const tableDir = path.join(CONFIG.localFolder, table);
    const expectedParent = path.resolve(tableDir);
    const actualParent = path.resolve(path.dirname(folderPath));
    if (actualParent !== expectedParent) {
        console.error(`   ❌ Invalid path: folder must be inside ${table}/ (got ${folderPath})`);
        return;
    }
    console.log(`✨ Creating NEW record in [${table}] from folder: ${recordName}...`);

    const payload = {};
    const config = CONFIG.mapping[table];

    if (config && config.fields) {
        config.fields.forEach(field => {
            const ext = config.ext[field];
            const fname = `${field}.${ext}`;
            const fpath = path.join(folderPath, fname);
            if (fs.existsSync(fpath)) {
                payload[field] = fs.readFileSync(fpath, 'utf8');
            }
        });
    }

    const jsonFiles = ['_properties.json', '_record.json', 'meta.json'];
    for (const jf of jsonFiles) {
        const jsonPath = path.join(folderPath, jf);
        if (fs.existsSync(jsonPath)) {
            try {
                const data = fs.readJsonSync(jsonPath);
                for (const [k, v] of Object.entries(data)) {
                    if (payload[k] != null) continue;
                    if (v && typeof v === 'object' && 'value' in v) {
                        payload[k] = v.value;
                    } else {
                        payload[k] = v;
                    }
                }
            } catch (e) {
                console.warn(`   ⚠️ Invalid JSON metadata: ${e.message}`);
            }
        }
    }

    payload.name = recordName;

    if (Object.keys(payload).length === 0) {
        console.error('   ❌ No data found to create record. (Check json files or field files)');
        return;
    }

    // 2. POST (Create)
    try {
        const res = await snClient.post(`/api/now/table/${table}`, payload);
        const result = res.data.result;
        
        if (result && result.sys_id) {
            console.log(`   ✅ Record created! SysID: ${result.sys_id}`);
            
            fs.outputFileSync(path.join(folderPath, '.sys_id'), result.sys_id);
            if (result.sys_updated_on) {
                fs.outputFileSync(path.join(folderPath, '.sys_updated_on'), result.sys_updated_on);
            }
            
            const jsonName = table === 'sys_properties' ? '_properties.json' : '_record.json';
            const jsonPath = path.join(folderPath, jsonName);
            
            let finalJson = {};
            if (fs.existsSync(jsonPath)) finalJson = fs.readJsonSync(jsonPath);
            
            finalJson.sys_id = { value: result.sys_id, display_value: result.sys_id };
            const displayName = result.name || result.api_name || recordName;
            if (displayName) finalJson.name = { value: displayName, display_value: displayName };
            
            fs.writeJsonSync(jsonPath, finalJson, { spaces: 4 });
            
            if (config && config.saveContext) {
                const contextPath = path.join(folderPath, '_ai_context.md');
                if (!fs.existsSync(contextPath)) {
                    const contextContent = `# AI Context: ${displayName}\n\n> **Auto-generated context**\n\n`;
                    fs.writeFileSync(contextPath, contextContent);
                }
            }
        }
    } catch (e) {
         console.error(`   🔥 Creation Failed:`, e.response?.data?.error?.message || e.message);
         if (e.response && e.response.data) console.error(JSON.stringify(e.response.data, null, 2));
    }
}

async function pushToServiceNow(filePath) {
    const fileName = path.basename(filePath);
    
    // Ignore context files, hidden files and AI metadata
    if (fileName.startsWith('.') || fileName.includes('.ai_context')) return;

    const dirPath = path.dirname(filePath);
    const parentDir = path.dirname(dirPath); // src/table or src
    
    // Try to find .sys_id in the same folder as the file
    const sysIdPath = path.join(dirPath, '.sys_id');
    
    let sysId, table, field, extension;

    // --- NEW MODE (FOLDERS) ---
    if (fs.existsSync(sysIdPath)) {
        sysId = fs.readFileSync(sysIdPath, 'utf8').trim();
        table = path.basename(parentDir); // Assume: src/table/Record/file.js
        
        // Filename is "field.ext" (e.g., script.js, template.html)
        const parts = fileName.split('.');
        extension = parts.pop();
        field = parts.join('.'); // Supports fields with dots? Generally no, but ok.
    } 
    // --- LEGACY MODE (COMPATIBILITY FOR OLD FILES REMAINING IN ROOT) ---
    else {
         // Old parse: Name.SysID.Field.ext
        const parts = fileName.split('.');
        if (parts.length >= 4) {
            extension = parts.pop();
            field = parts.pop();
            sysId = parts.pop();
            table = path.basename(dirPath);
        } else {
            return; // File not recognized
        }
    }
    
    // Security validation
    if (!CONFIG.mapping[table]) return;

    console.log(`🔄 Uploading: ${table} | Field: ${field}...`);

    // --- OVERWRITE PROTECTION (COLLISION CHECK) ---
    const updatedOnPath = path.join(dirPath, '.sys_updated_on');
    if (fs.existsSync(updatedOnPath)) {
        const localUpdatedOn = fs.readFileSync(updatedOnPath, 'utf8').trim();
        
        try {
            // Check version on server before uploading
            // sysparm_display_value=false ENSURES we compare raw string from DB
            const checkRes = await snClient.get(`/api/now/table/${table}/${sysId}?sysparm_fields=sys_updated_on,sys_updated_by&sysparm_display_value=false`);
            const serverUpdatedOn = checkRes.data.result.sys_updated_on;
            const updatedBy = checkRes.data.result.sys_updated_by;

            if (serverUpdatedOn && localUpdatedOn !== serverUpdatedOn) {
                console.error(`\n🛑 BLOCKED: Version Conflict Detected!`);
                console.error(`   Local:    ${localUpdatedOn}`);
                console.error(`   Server:   ${serverUpdatedOn} (by ${updatedBy})`);
                console.error(`   Solution: Save your changes elsewhere, run 'snsync --pull' and re-apply.`);
                return; // Abort upload
            }
        } catch (e) {
            console.warn(`   ⚠️ Could not check conflicts on server. Proceeding at your own risk...`);
        }
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const payload = {};
    payload[field] = content;

    try {
        const putRes = await snClient.put(`/api/now/table/${table}/${sysId}`, payload);
        
        // Update local timestamp to new one, allowing future pushes without conflict
        if (putRes.data.result && putRes.data.result.sys_updated_on) {
             fs.outputFileSync(updatedOnPath, putRes.data.result.sys_updated_on);
        }

        const recordUrl = generateRecordUrl(table, sysId);
        console.log(`   ✨ Success! Saved to ServiceNow.`);
        console.log(`      🔗 ${recordUrl}`);
    } catch (error) {
        console.error(`   🔥 Error:`, error.response?.data?.error?.message || error.message);
    }
}

function generateRecordUrl(table, sysId) {
    const target = `${table}.do?sys_id=${sysId}`;
    const encodedTarget = encodeURIComponent(target);
    // Polaris/Next Experience URL format
    return `${CONFIG.url}/now/nav/ui/classic/params/target/${encodedTarget}`;
}

async function handleOpen(target) {
    if (!target || target === 'true') {
        console.log('❌ You must specify the file or folder to open.');
        return;
    }

    let filePath = target;
    // If folder, try to find .sys_id inside
    if (fs.lstatSync(target).isDirectory()) {
         filePath = path.join(target, '.sys_id'); // dummy path for logic below
    }

    const dirPath = fs.lstatSync(target).isDirectory() ? target : path.dirname(filePath);
    const parentDir = path.dirname(dirPath); 
    const sysIdPath = path.join(dirPath, '.sys_id');

    if (fs.existsSync(sysIdPath)) {
        const sysId = fs.readFileSync(sysIdPath, 'utf8').trim();
        const table = path.basename(parentDir);
        const url = generateRecordUrl(table, sysId);
        console.log(`🚀 Opening: ${url}`);
        await open(url);
    } else {
        console.log('❌ Could not identify .sys_id for this item.');
        console.log('   Ensure .sys_id file exists in the folder.');
    }
}

async function pushAllNewFromAllTables() {
    console.log('🚀 Pushing all new records from all tables...');
    const tables = Object.entries(CONFIG.mapping).filter(([, c]) => c.fields && !c.onlyContext);
    for (const [tableName, config] of tables) {
        const tableDir = path.join(CONFIG.localFolder, tableName);
        if (!fs.existsSync(tableDir) || !fs.lstatSync(tableDir).isDirectory()) continue;
        const children = fs.readdirSync(tableDir);
        for (const child of children) {
            const childPath = path.join(tableDir, child);
            if (!fs.lstatSync(childPath).isDirectory()) continue;
            if (child.startsWith('.') || child === '.ai_context') continue;
            const sysIdPath = path.join(childPath, '.sys_id');
            if (!fs.existsSync(sysIdPath)) {
                await createRecordInServiceNow(childPath, tableName);
            }
        }
    }
}

async function handleManualPush(target, table, name) {
    console.log('🚀 Starting Manual Push...');
    
    // Normalize target
    let targetPath = target && target !== 'true' ? target : null;
    
    if (!targetPath && table && name) {
        targetPath = path.join(CONFIG.localFolder, table, name);
    }
    if (!targetPath && table && !name) {
        targetPath = path.join(CONFIG.localFolder, table);
    }
    if (!targetPath && args.includes('--all')) {
        await pushAllNewFromAllTables();
        return;
    }

    if (!targetPath) {
        console.error('❌ Insufficient parameters. Usage: --push src/table/folder | --push --table X --name Y | --push --table X (all new) | --push --all');
        return;
    }
    
    if (!fs.existsSync(targetPath)) {
        console.error(`❌ Path not found: ${targetPath}`);
        return;
    }

    const stats = fs.lstatSync(targetPath);

    // Case 1: Single File
    if (stats.isFile()) {
        console.log(`   📄 Single file detected: ${path.basename(targetPath)}`);
        // If file is inside a "New Record" folder (no .sys_id), this calls pushToServiceNow which fails/skips? 
        // We probably assume user knows what they are doing. 
        // But if they push a single file in a new record, maybe they want to create the record?
        // Let's check context.
        const dirPath = path.dirname(targetPath);
        const sysIdPath = path.join(dirPath, '.sys_id');
        if (!fs.existsSync(sysIdPath)) {
            // It is a file in a NEW record folder.
            // Delegate to Creating the whole record because partial POST is bad.
            const parentName = path.basename(path.dirname(dirPath));
            if (CONFIG.mapping[parentName]) {
                 console.log(`   🆕 New Record detected from single file. Creating full record...`);
                 await createRecordInServiceNow(dirPath, parentName);
                 return;
            }
        }
        await pushToServiceNow(targetPath);
        return;
    }

    // Case 2: Directory
    if (stats.isDirectory()) {
        const dirName = path.basename(targetPath);
        const parentName = path.basename(path.dirname(targetPath));
        
        // Scenario A: It is a Record Folder (Parent is a mapped table OR user specified table)
        // Check if parent matches a table
        let tableName = CONFIG.mapping[parentName] ? parentName : null;
        
        // If exact table param was passed, trust it
        if (!tableName && table) tableName = table;

        // If we found a valid table context
        if (tableName) { 
             const sysIdPath = path.join(targetPath, '.sys_id');
             
             if (fs.existsSync(sysIdPath)) {
                 // Push All Files (Update)
                 console.log(`   📂 Updating record: ${dirName}`);
                 const files = fs.readdirSync(targetPath);
                 for (const file of files) {
                    if (file.startsWith('.')) continue; 
                    const fp = path.join(targetPath, file);
                    if (fs.lstatSync(fp).isFile()) await pushToServiceNow(fp);
                 }
             } else {
                 // Create New
                 await createRecordInServiceNow(targetPath, tableName);
             }
             return;
        }

        // Scenario B: It is a Table Folder (The folder itself IS the table)
        // e.g. src/sys_script
        if (CONFIG.mapping[dirName]) {
             console.log(`   📦 Bulk Mode: Scanning table [${dirName}]...`);
             const children = fs.readdirSync(targetPath);
             for (const child of children) {
                 const childPath = path.join(targetPath, child);
                 if (fs.lstatSync(childPath).isDirectory()) {
                     // Check if it's new
                     const childSysId = path.join(childPath, '.sys_id');
                     if (!fs.existsSync(childSysId)) {
                        await createRecordInServiceNow(childPath, dirName);
                     } else {
                        // Optional: Could update existing too, but 'Bulk Create' is safer default for broad push
                        // console.log(`      Skipping existing: ${child}`); 
                     }
                 }
             }
             return;
        }
        
        console.error(`❌ Folder '${dirName}' is neither a configured table nor a record inside one.`);
    }
    
    console.error('❌ Insufficient parameters.');
    console.error('   Usage 1: --push src/table/folder/file.js');
    console.error('   Usage 2: --push --table sp_widget --name Folder_Name');
}

// --- EXECUTION ---

// Simple arg parser
function getArgValue(flag) {
    const idx = args.indexOf(flag);
    const next = idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    return next && !next.startsWith('--') ? next : null;
}

if (args.includes('--pull')) {
    let options = {
        table: getArgValue('--table'),
        query: getArgValue('--query')
    };

    // Support --target for Surgical Pull (Update current record)
    const target = getArgValue('--target');
    if (target && fs.existsSync(target)) {
        // Try to discover context (Table + SysId) based on file
        let searchPath = target;
        if (fs.lstatSync(searchPath).isFile()) searchPath = path.dirname(searchPath); // Get folder if it's a file
        
        const sysIdPath = path.join(searchPath, '.sys_id');
        
        // If not found in immediate folder, try one level up (if using src/table/record/extra_folder)
        // But our structure is src/table/record, so searchPath should be the record.
        
        if (fs.existsSync(sysIdPath)) {
            const sysId = fs.readFileSync(sysIdPath, 'utf8').trim();
            // src/table/record -> Get table name (parent of record)
            const tableDir = path.dirname(searchPath); 
            const tableName = path.basename(tableDir);
            
            console.log(`🎯 Surgical Pull detected: Table [${tableName}] ID [${sysId}]`);
            options.table = tableName;
            options.query = `sys_id=${sysId}`;
        } else {
             console.error('❌ Could not identify .sys_id for this file. Surgical pull impossible.');
             process.exit(1);
        }
    }

    pullFromServiceNow(options);
} 
else if (args.includes('--push')) {
    const target = getArgValue('--push');
    const table = getArgValue('--table');
    const name = getArgValue('--name'); // Expects FOLDER name
    handleManualPush(target, table, name);
}
else if (args.includes('--open')) {
    const target = getArgValue('--open');
    handleOpen(target);
}
else if (args.includes('--watch')) {
    console.log(`👀 Monitoring: ${CONFIG.localFolder}`);
    console.log(`   (Edit files and save to push to ServiceNow; new records created on save)`);
    
    const watcher = chokidar.watch(CONFIG.localFolder, { persistent: true, ignoreInitial: true });
    
    watcher.on('change', (filePath) => {
        const ext = path.extname(filePath);
        if (!['.js', '.html', '.css', '.xml', '.scss', '.json', '.txt'].includes(ext) || filePath.includes('.ai_context')) return;
        const dirPath = path.dirname(filePath);
        const sysIdPath = path.join(dirPath, '.sys_id');
        if (!fs.existsSync(sysIdPath)) {
            const tableDir = path.dirname(dirPath);
            const tableName = path.basename(tableDir);
            if (CONFIG.mapping[tableName] && CONFIG.mapping[tableName].fields) {
                createRecordInServiceNow(dirPath, tableName);
                return;
            }
        }
        pushToServiceNow(filePath);
    });
} else {
    console.log('Commands: node sn-sync.js --pull | node sn-sync.js --watch');
}
