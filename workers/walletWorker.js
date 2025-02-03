import { parentPort } from 'worker_threads';
import log from '../utils/logger.js';
import LayerEdge from '../utils/socket.js';

parentPort.on('message', async ({ wallet, proxy }) => {
    try {
        const { address, privateKey } = wallet;
        const socket = new LayerEdge(proxy, privateKey);
        
        log.info(`Processing Wallet Address: ${address} with proxy:`, proxy);
        log.info(`Checking Node Status for: ${address}`);
        await socket.checkIN();
        const isRunning = await socket.checkNodeStatus();

        if (isRunning) {
            log.info(`Wallet ${address} is running - trying to claim node points...`);
            await socket.stopNode();
        }
        
        log.info(`Trying to reconnect node for Wallet: ${address}`);
        await socket.connectNode();

        log.info(`Checking Node Points for Wallet: ${address}`);
        await socket.checkNodePoints();
        
        parentPort.postMessage({ success: true, address });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message, address: wallet.address });
    }
});
