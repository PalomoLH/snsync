const fs = require('fs-extra');
const path = require('path');

// Helper to parse arguments --flag value
const args = process.argv.slice(2);
function getArg(flag) {
    const idx = args.indexOf(flag);
    return (idx !== -1 && args[idx + 1]) ? args[idx + 1] : '';
}

const name = getArg('--name');
const instance = getArg('--instance');
const clientId = getArg('--clientId');
const clientSecret = getArg('--clientSecret');
const user = getArg('--user');
const pass = getArg('--password');

if (!name) {
    console.error('❌ Error: Project name is required (--name)');
    process.exit(1);
}
if (!instance) {
    console.error('❌ Error: Instance URL is required (--instance)');
    process.exit(1);
}

// Base directory for projects is assumed as ../projects relative to this script in _tool/
const rootDir = path.resolve(__dirname, '..');
const projectsDir = path.join(rootDir, 'projects');
const targetDir = path.join(projectsDir, name);

if (fs.existsSync(targetDir)) {
    console.error(`❌ Error: Project with name '${name}' already exists at ${targetDir}`);
    process.exit(1);
}

console.log(`🔨 Creating project '${name}'...`);

try {
    // 1. Create folder structure
    fs.ensureDirSync(path.join(targetDir, 'src'));

    // 2. Copy TEMPLATE content to new project
    // (.vscode, .github, sn-config.json, etc)
    const templatesDir = path.join(__dirname, 'templates');
    if (fs.existsSync(templatesDir)) {
        fs.copySync(templatesDir, targetDir); 
        console.log('   ✅ Default structure (Templates) copied.');
    } else {
        console.warn('   ⚠️ _tool/templates folder not found. Only basic structure created.');
        // Fallback: create empty sn-config if none exists
        fs.outputJSONSync(path.join(targetDir, 'sn-config.json'), { mapping: {} }, { spaces: 4 });
    }

    // 3. Create .env file (instance specific)
    let envContent = `SN_INSTANCE=${instance}\n`;
    
    if (clientId) envContent += `SN_CLIENT_ID=${clientId}\n`;
    if (clientSecret) envContent += `SN_CLIENT_SECRET=${clientSecret}\n`;
    
    if (user) envContent += `SN_USER=${user}\n`;
    if (pass) envContent += `SN_PASSWORD=${pass}\n`;
    
    // If no user/pass but has ID, it's Browser Auth
    if (clientId && !user) {
        envContent += `# Browser Authentication (OAuth Authorization Code)\n`;
    }

    fs.writeFileSync(path.join(targetDir, '.env'), envContent);
    console.log('   ✅ .env file generated.');

    console.log(`\n🎉 Project '${name}' created successfully!`);
    console.log(`   📂 Location: ${targetDir}`);
    console.log(`   👉 To use: Select this project in VS Code Tasks.`);

} catch (e) {
    console.error(`❌ Failed to create project: ${e.message}`);
    process.exit(1);
}
