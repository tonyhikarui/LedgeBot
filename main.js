import fs from 'fs/promises'
import { Worker } from 'worker_threads';
import log from './utils/logger.js'
import { readFile, delay } from './utils/helper.js'
import banner from './utils/banner.js';

const WALLETS_PATH = 'wallets.json'
const MAX_CONCURRENT_WORKERS = 5; // Adjust based on your needs

// Function to read wallets 
async function readWallets() {
    try {
        await fs.access(WALLETS_PATH);

        const data = await fs.readFile(WALLETS_PATH, "utf-8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            log.info("No wallets found in", WALLETS_PATH);
            return [];
        }
        throw err;
    }
}

async function processWalletBatch(wallets, proxies) {
    const activeWorkers = new Set();
    const walletQueue = [...wallets];

    while (walletQueue.length > 0 || activeWorkers.size > 0) {
        while (activeWorkers.size < MAX_CONCURRENT_WORKERS && walletQueue.length > 0) {
            const wallet = walletQueue.shift();
            const proxy = proxies[wallets.indexOf(wallet) % proxies.length] || null;
            
            const worker = new Worker('./workers/walletWorker.js', { type: 'module' });
            activeWorkers.add(worker);

            worker.on('message', (result) => {
                if (!result.success) {
                    log.error(`Error Processing wallet ${result.address}:`, result.error);
                }
            });

            worker.on('error', (error) => {
                log.error('Worker error:', error);
            });

            worker.on('exit', () => {
                activeWorkers.delete(worker);
            });

            worker.postMessage({ wallet, proxy });
        }

        await delay(1); // Small delay to prevent CPU overload
    }
}

async function run() {
    log.info(banner);
    await delay(3);

    const proxies = await readFile('proxy.txt');
    let wallets = await readWallets();
    if (proxies.length === 0) log.warn("No proxies found in proxy.txt - running without proxies");
    if (wallets.length === 0) {
        log.info('No Wallets found, creating new Wallets first "npm run autoref"');
        return;
    }

    log.info('Starting run Program with all Wallets:', wallets.length);

    while (true) {
        await processWalletBatch(wallets, proxies);
        log.warn(`All Wallets have been processed, waiting 1 hour before next run...`);
        await delay(60 * 60);
    }
}

run();