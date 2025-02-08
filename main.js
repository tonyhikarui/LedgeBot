import fs from 'fs/promises'
import log from './utils/logger.js'
import { readFile, delay } from './utils/helper.js'
import banner from './utils/banner.js';
import LayerEdge from './utils/socket.js';

const WALLETS_PATH = 'wallets.json'

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

async function processWallet(wallet, proxy, index, total) {
    try {
        const { address, privateKey } = wallet;
        const socket = new LayerEdge(proxy, privateKey);
        
        log.info(`[${index}/${total}] Processing Wallet Address: ${address} with proxy:`, proxy);
        log.info(`[${index}/${total}] Checking Node Status for: ${address}`);
        await socket.checkIN();
        const isRunning = await socket.checkNodeStatus();

        if (isRunning) {
            log.info(`[${index}/${total}] Wallet ${address} is running - trying to claim node points...`);
            await socket.stopNode();
        }
        
        log.info(`[${index}/${total}] Trying to reconnect node for Wallet: ${address}`);
        await socket.connectNode();

        log.info(`[${index}/${total}] Checking Node Points for Wallet: ${address}`);
        await socket.checkNodePoints();
    } catch (error) {
        log.error(`[${index}/${total}] Error Processing wallet:`, error.message);
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
    let runCount = 1;

    while (true) {
        log.info(`Starting Run #${runCount}`);
        for (let i = 0; i < wallets.length; i++) {
            const wallet = wallets[i];
            const proxy = proxies[i % proxies.length] || null;
            await processWallet(wallet, proxy, i + 1, wallets.length);
        }
        log.warn(`Run #${runCount} completed. All Wallets have been processed, waiting 1 hour before next run...`);
        runCount++;
        await delay(60);
    }
}

run();