#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptsDirectory = __dirname;
const testFiles = fs.readdirSync(scriptsDirectory)
  .filter(file => /^test_.*\.js$/.test(file))
  .sort();

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, [path.join(scriptsDirectory, testFile)], {
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Suite de contratos: ${testFiles.length} arquivos executados com sucesso`);
