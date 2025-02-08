import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import { Worker } from 'worker_threads';
import log from './utils/logger.js';
import { readFile, delay } from './utils/helper.js';
import banner from './utils/banner.js';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_CONFIG = {
  host: 'localhost',
  user: 'ledge',
  password: 'hfLEsAtStG4LzETZ',
  database: 'ledge'
};

const CONFIG = {
  BATCH_SIZE: 4,          // Process multiple wallets in a batch
  NUM_WORKERS: 4,         // Use multiple workers
  START_OFFSET: 0,
  PROCESS_AMOUNT: 1000,
  WORKER_DELAY: 1,
  WALLET_DELAY: 2,
  WORKER_TIMEOUT: 120000  // Increased timeout to 120 seconds
};

// Worker pool management
const workers = new Map();
const taskQueue = [];

async function readWalletsFromDB(offset = 0, limit = 100) {
  const connection = await mysql.createConnection(DB_CONFIG);
  try {
    const [rows] = await connection.execute(
      'SELECT address, privateKey FROM wallets LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  } finally {
    await connection.end();
  }
}

// Add initializeWorkers function
async function initializeWorkers() {
    for (let i = 0; i < CONFIG.NUM_WORKERS; i++) {
        const worker = new Worker(path.join(__dirname, 'worker.js'), {
            type: 'module',
            workerData: {
                workerIndex: i,
                totalWorkers: CONFIG.NUM_WORKERS
            }
        });

        worker.setMaxListeners(100);

        worker.on('error', (error) => {
            log.error(`Worker ${i} error: ${error}`);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                log.error(`Worker ${i} stopped with exit code ${code}`);
            }
            workers.delete(i);
            log.warn(`Worker ${i} exited. Active workers: ${workers.size}`);
        });

        workers.set(i, worker);
        log.info(`Initialized worker ${i}`);
        await delay(CONFIG.WORKER_DELAY);
    }
    
    log.info(`All ${CONFIG.NUM_WORKERS} workers initialized`);
}

// Remove duplicate createWorker function since we're using initializeWorkers
// Delete or comment out the old createWorker function

// Function to add tasks to the queue
function enqueueTask(task) {
    taskQueue.push(task);
}

// Function to process the task queue
async function processTaskQueue(proxies, errorCount, totalProcessed) {
    const taskPromises = taskQueue.splice(0, taskQueue.length).map(async task => {
        const { wallet, workerIndex, offset, proxiesIndex, currentCount } = task;

        const proxy = proxies[proxiesIndex % proxies.length] || null;
        const worker = workers.get(workerIndex);

        if (!worker) {
            log.error(`Worker ${workerIndex} not found`);
            errorCount.value++;
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    log.error(`Worker ${workerIndex}: Timeout processing wallet ${wallet.address}`);
                    reject(new Error('Worker timeout'));
                }, CONFIG.WORKER_TIMEOUT);

                const messageHandler = async (message) => {
                    clearTimeout(timeout);
                    if (message.success) {
                        log.info(`Wallet ${wallet.address} processed successfully`);
                        resolve();
                    } else {
                        log.error(`Error processing wallet ${wallet.address}: ${message.error}`);
                        reject(new Error(message.error));
                    }
                    worker.removeListener('message', messageHandler);
                };

                worker.on('message', messageHandler);
                worker.postMessage({
                    wallet,
                    proxy,
                    index: offset + 1,
                    total: CONFIG.PROCESS_AMOUNT,
                    currentCount
                });
            });
            log.info(`Worker ${workerIndex}: Successfully completed wallet ${wallet.address}`);
        } catch (error) {
            log.error(`Worker ${workerIndex}: Error processing wallet ${wallet.address}: ${error.message}`);
            errorCount.value++;
        }
        await delay(CONFIG.WALLET_DELAY);
    });

    await Promise.all(taskPromises);
}

async function logJobCompletion(startTime, totalProcessed, errorCount) {
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
  const avgTimePerWallet = (totalTime / totalProcessed).toFixed(2);

  log.info(`Complete job run finished:`);
  log.info(`- Total wallets: ${totalProcessed}`);
  log.info(`- Total time: ${totalTime} minutes`);
  log.info(`- Average time per wallet: ${avgTimePerWallet} minutes`);
  log.info(`- Errors: ${errorCount}`);
}

async function run() {
  log.info(banner);
  await delay(3);

  const proxies = await readFile('proxy.txt');
  if (proxies.length === 0) log.warn("No proxies found in proxy.txt - running without proxies");

  let runCount = 1;

  // Initialize workers before starting the main loop
  await initializeWorkers();

  while (true) {
    const startTime = Date.now();
    let offset = CONFIG.START_OFFSET;
    let totalProcessed = 0;
    let errorCount = { value: 0 };

    log.info(`Starting Run #${runCount}`);

    while (offset < CONFIG.PROCESS_AMOUNT) {
      const remainingWallets = CONFIG.PROCESS_AMOUNT - offset;
      const currentBatchSize = Math.min(CONFIG.BATCH_SIZE, remainingWallets);
      
      const wallets = await readWalletsFromDB(offset, currentBatchSize);
      
      if (wallets.length === 0) {
        log.warn(`No wallets found at offset ${offset}, ending run`);
        break;
      }

      log.info(`Processing batch of ${wallets.length} wallets (offset: ${offset})...`);

      // Enqueue tasks for each wallet
      for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i];
        const workerIndex = i % CONFIG.NUM_WORKERS;
        const currentCount = totalProcessed + i + 1;
        enqueueTask({ wallet, workerIndex, offset, proxiesIndex: i, currentCount });
      }

      // Process the task queue
      await processTaskQueue(proxies, errorCount, totalProcessed);

      totalProcessed += wallets.length;
      offset += wallets.length;

      log.info(`Batch completed. Total processed: ${totalProcessed}`);
      await delay(CONFIG.WORKER_DELAY);

      if (totalProcessed % 100 === 0) {
        const progress = ((offset / CONFIG.PROCESS_AMOUNT) * 100).toFixed(1);
        log.info(`Progress: ${progress}% (${offset}/${CONFIG.PROCESS_AMOUNT} wallets)`);
      }
    }

    await logJobCompletion(startTime, totalProcessed, errorCount.value);
    log.warn(`Run #${runCount} completed. Waiting 1 hour before next run...`);
    runCount++;
    await delay(3); // 1 hour delay
  }
}

// Handle cleanup
process.on('SIGINT', async () => {
  log.warn('Process terminated by user.');
  for (const worker of workers.values()) {
    worker.terminate();
  }
  process.exit(0);
});

run().catch(async err => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});