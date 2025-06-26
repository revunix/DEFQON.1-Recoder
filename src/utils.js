const { exec } = require('child_process');

function checkCommand(command) {
  return new Promise((resolve) => {
    exec(`${command} --version`, (error) => {
      resolve(!error);
    });
  });
}

module.exports = { checkCommand };
