const { SerialPort } = require('serialport');

const DEFAULT_INTER_WRITE_DELAY_MS = Number.parseInt(process.env.DAX88_INTER_WRITE_DELAY_MS || '50', 10);
const DEFAULT_QUEUE_TASK_TIMEOUT_MS = Number.parseInt(process.env.DAX88_QUEUE_TASK_TIMEOUT_MS || '2500', 10);

let port;
let queueTail = Promise.resolve();
let queueStopped = false;

function getSerialConfig() {
  return {
    path: process.env.DAX88_SERIAL_PORT || process.env.DAX88_SERIAL_PATH || '/dev/ttyUSB0',
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

function closePort() {
  if (!port) {
    return Promise.resolve({ closed: false, reason: 'not_initialized' });
  }

  if (!port.isOpen) {
    port = null;
    return Promise.resolve({ closed: false, reason: 'already_closed' });
  }

  return new Promise((resolve, reject) => {
    port.close((error) => {
      if (error) {
        return reject(error);
      }
      port = null;
      resolve({ closed: true });
    });
  });
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

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Serial queue task timed out (${label}) after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function writeNow(command) {
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

function enqueueCommand(task, {
  timeoutMs = DEFAULT_QUEUE_TASK_TIMEOUT_MS,
  interWriteDelayMs = DEFAULT_INTER_WRITE_DELAY_MS,
  label = 'serial-write'
} = {}) {
  if (queueStopped) {
    return Promise.reject(new Error('Serial queue is stopped'));
  }

  const run = async () => {
    const result = await withTimeout(Promise.resolve().then(task), timeoutMs, label);
    if (interWriteDelayMs > 0) {
      await wait(interWriteDelayMs);
    }
    return result;
  };

  const queuedTask = queueTail.then(run, run);
  queueTail = queuedTask.catch(() => {});
  return queuedTask;
}

async function writeCommand(command, options = {}) {
  if (process.env.DAX88_SERIAL_DISABLED === 'true') {
    return { skipped: true, reason: 'DAX88_SERIAL_DISABLED=true' };
  }

  return enqueueCommand(() => writeNow(command), {
    timeoutMs: options.timeoutMs,
    interWriteDelayMs: options.interWriteDelayMs,
    label: options.label
  });
}

function stopQueue() {
  queueStopped = true;
}

async function drainQueue(timeoutMs = 4000) {
  await Promise.race([
    queueTail.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

module.exports = {
  closePort,
  drainQueue,
  ensureOpen,
  enqueueCommand,
  getSerialConfig,
  initPort,
  stopQueue,
  writeCommand
};
