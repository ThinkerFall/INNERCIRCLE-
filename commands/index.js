const fs = require('fs');
const path = require('path');

const commandFiles = fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.js') && file !== 'index.js');

const commands = commandFiles.flatMap(file => require(path.join(__dirname, file)));

module.exports = commands;
