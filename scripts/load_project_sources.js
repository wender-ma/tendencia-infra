const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadProjectSources() {
  const viewDirectory = path.join(root, 'assets/views/tabs');
  const viewMarkup = fs
    .readdirSync(viewDirectory)
    .filter((file) => file.endsWith('.html'))
    .sort()
    .map((file) => fs.readFileSync(path.join(viewDirectory, file), 'utf8'));
  const html = [
    readProjectFile('index.html'),
    readProjectFile('assets/views/dialogs.html'),
    ...viewMarkup,
  ].join('\n');
  const javascript = [
    readProjectFile('assets/js/dashboard-legacy.js'),
    readProjectFile('assets/js/services/dashboard-export.mjs'),
    readProjectFile('assets/js/ui/flow-editor.mjs'),
    readProjectFile('assets/js/ui/uploads.mjs'),
    readProjectFile('assets/js/ui/views/admin.mjs'),
    readProjectFile('assets/js/ui/views/details.mjs'),
    readProjectFile('assets/js/ui/views/flows.mjs'),
    readProjectFile('assets/js/ui/views/history.mjs'),
    readProjectFile('assets/js/ui/views/overview.mjs'),
    readProjectFile('assets/js/ui/views/projection.mjs'),
    readProjectFile('assets/js/ui/views/projection-control.mjs'),
  ].join('\n');
  return {
    root,
    html,
    javascript,
    source: `${html}\n${javascript}`,
  };
}

module.exports = { loadProjectSources, readProjectFile, root };
