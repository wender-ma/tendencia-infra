const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadProjectSources() {
  const html = readProjectFile('index.html');
  const javascript = readProjectFile('assets/js/dashboard-legacy.js');
  return {
    root,
    html,
    javascript,
    source: `${html}\n${javascript}`,
  };
}

module.exports = { loadProjectSources, readProjectFile, root };
