'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const isdir = require('is-directory');
const arrayExclude = require('arr-exclude');
const stripPath = require('strip-path');
const execa = require('execa');
const indentString = require('indent-string');
const table = require('markdown-table');
const jsonfile = require('jsonfile');
const arrayInclude = require('arr-include');

function findImageName(files) {
  return files.find(name => {
    return name.endsWith('.img');
  });
}

function parseTestSh(fullPath) {
  // TODO: This is not The Highlander! There CAN be more than one!
  let makeCmd = {
    'command': 'make',
    'options': []
  };
  try {
    let content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    const firstItem = lines.find(line => {
      return line.startsWith('make ');
    });
    const components = firstItem.split(' ');
    makeCmd.options = components.slice(1);
  }
  catch (error) {
    // no test.sh found
  }
  return makeCmd;
}

function processTestFolder(name, fullPath) {
  let test = {};
  test.name = name;
  test.builds = false;
  test.succeeds = 'false';
  let makeCmd = parseTestSh(path.join(fullPath, 'test.sh'));
  execa('make', ['clean'], {'cwd': fullPath}).then(result => {
    // makeCmd = { 'command': 'make', 'options': []};
    execa(makeCmd.command, makeCmd.options, {'cwd': fullPath}).then(result => {
      test.buildResult = result.stdout;
      test.builds = 'true';
      const options = {'cwd': fullPath, 'timeout': 10000};
      const imageName = findImageName(fs.readdirSync(fullPath));
      execa.shell(path.join(fullPath, 'run.sh') + ' ' + imageName, options).then(result => {
          test.runResult = result.stdout;
          test.succeeds = true;
      }).catch(error => {
        // run always 'fails' since we kill it after a timeout
        if (error.killed === true) {
          test.succeeds = true;
        }
        test.runResult = error.stdout;
      });
    }).catch(error => {
      test.buildResult = error.stdout;
    });
  }).catch(error => {
    // 'make clean' error
  });
  items.push(test);
}


const excludedPaths = ['lest', 'virtualbox', 'unittests'];
let items = [];
let successCriteria = jsonfile.readFileSync('successCriteria.json');

process.on('exit', () => {
  console.log('Items: ' + items.length + '\n\n');
  let infoTable = [];
  let header = ['Test', 'Builds', 'Runs', 'Status'];
  infoTable.push(header);
  items.forEach(item => {
    if (item.runResult === undefined) item.runResult = '';
    let actualOutputLines = item.runResult.split('\n').map(line => {
      return line.trim();
    });
    const desiredOutputLines = successCriteria[item.name];
    let desiredLength = 0;
    if (desiredOutputLines !== undefined) {
      desiredLength = desiredOutputLines.length;
    }
    const matchedOutputLines = arrayInclude(desiredOutputLines, actualOutputLines);
    let passed = 'fail';
    if (desiredLength > 0 && (matchedOutputLines.length === desiredLength)) {
      passed = 'pass';
    }
    let line = [item.name, item.builds, item.succeeds, passed + ' (' + matchedOutputLines.length + '/' + desiredLength + ')'];
    infoTable.push(line);
  });
  console.log(table(infoTable));

  items.forEach(item => {
    if (item.buildResult === undefined) item.buildResult = '';
    let resultLines = item.buildResult.split('\n');
    resultLines.splice(resultLines.findIndex(line => {
      return line.startsWith('Signature:');
    }), 1);
    const buildResult = resultLines.join('\n');
    if (item.runResult === undefined) item.runResult = '';
    console.log('\n## ' + item.name);
    console.log('\n### Build output\n\n' + indentString(buildResult, ' ', 4) + '\n\n');
    console.log('\n### Run output\n\n' + indentString(item.runResult, ' ', 4) + '\n\n---')
  })
});

const root = path.join(os.homedir(), path.join('IncludeOS', 'test'));

fs.readdir(root, (err, files) => {
  if (!err) {
    const includedPaths = arrayExclude(files, excludedPaths);
    for (const file of includedPaths) {
      const fullPath = path.join(root, file);
      if (isdir.sync(fullPath)) {
        processTestFolder(file, fullPath);
      }
    }
  }
});
