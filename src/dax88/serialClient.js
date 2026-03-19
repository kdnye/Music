const { SerialPort } = require('serialport');

let port;

function getSerialConfig() {
  return {
    path: process.env.DAX88_SERIAL_PATH || '/dev/ttyUSB0',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    autoOpen: false
  };
}

function initPort() {
  if (port) return port;

  const config = getSerialConfig();
  port = new SerialPort(config);

  port.on('error', (error) => {
    console.error('[dax88] serial error:', error.message);
  });

  return port;
}

function ensureOpen(serialPort) {
  if (serialPort.isOpen) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    serialPort.open((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

async function writeCommand(command) {
  if (process.env.DAX88_SERIAL_DISABLED === 'true') {
    return { skipped: true, reason: 'DAX88_SERIAL_DISABLED=true' };
  }

  const serialPort = initPort();
  await ensureOpen(serialPort);

  return new Promise((resolve, reject) => {
    serialPort.write(command, (error) => {
      if (error) return reject(error);
      serialPort.drain((drainError) => {
        if (drainError) return reject(drainError);
        resolve({ skipped: false });
      });
    });
  });
}

module.exports = {
  ensureOpen,
  initPort,
  writeCommand
};
