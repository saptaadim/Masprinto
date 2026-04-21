const fs = require('fs');
const path = require('path');

function checkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            checkDir(fullPath);
        } else if (file.endsWith('.gs')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            try {
                // Simple check for basic syntax errors by wrapping in a function
                new Function('function dummy() { ' + content + ' }');
            } catch (e) {
                console.error(`Syntax error in ${fullPath}: ${e.message}`);
            }
        }
    }
}

checkDir('c:\\Users\\sapta\\OneDrive\\Desktop\\Masdim\\src');
