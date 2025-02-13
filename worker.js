import { parentPort, workerData } from 'worker_threads';
import log from './utils/logger.js';
import LayerEdge from './utils/socket.js';
import { delay } from './utils/helper.js';

parentPort.on('message', async (data) => {
  let socket;
  try {
    const { wallet, proxy, index, total, currentCount } = data;
    const startTime = Date.now();
    log.info(`Worker received new wallet task: ${wallet.address} (${currentCount}/${total})`);
    log.info(`[${currentCount}/${total}] Worker ${workerData.workerIndex}: Starting processing`);
    
    if (!wallet) {
      throw new Error('Wallet data is missing in worker data');
    }

    const { address, privateKey } = wallet;
    
    // Detailed connection logging
    //log.debug(`[${currentCount}/${total}] Creating LayerEdge instance for ${address}`);
    //log.debug(`[${currentCount}/${total}] Using proxy: ${proxy || 'none'}`);
    socket = new LayerEdge(proxy, privateKey);
    //log.debug(`[${currentCount}/${total}] LayerEdge instance created successfully`);
    
    log.info(`[${currentCount}/${total}] Processing Wallet Address: ${address} with proxy:`, proxy);
    await delay(1);
    
    // Check-in logging
    //log.debug(`[${currentCount}/${total}] Starting checkIN for ${address}`);
    //const checkInStart = Date.now();
    await socket.checkIN();
    //log.debug(`[${currentCount}/${total}] CheckIN completed for ${address} in ${Date.now() - checkInStart}ms`);
    //await delay(1);
    
    // Node status check with detailed logging
    //log.debug(`[${currentCount}/${total}] Starting node status check for ${address}`);
    const statusStart = Date.now();
    try {
      const isRunning = await socket.checkNodeStatus();
      //log.debug(`[${currentCount}/${total}] Node status check completed in ${Date.now() - statusStart}ms`);
      log.debug(`[${currentCount}/${total}] Node status: ${isRunning ? 'running' : 'not running'}`);

      //await delay(1);

      if (isRunning) {
        // Stop node process
        //log.info(`[${currentCount}/${total}] Wallet ${address} is running - trying to claim node points...`);
        const stopStart = Date.now();
        await socket.stopNode();
        log.debug(`[${currentCount}/${total}] Stop node completed in ${Date.now() - stopStart}ms`);
        await delay(1);
      }

      // Connect node process
      //log.info(`[${currentCount}/${total}] Trying to connect node for Wallet: ${address}`);
      const connectStart = Date.now();
      await socket.connectNode();
      log.debug(`[${currentCount}/${total}] Connect node completed in ${Date.now() - connectStart}ms`);
      //await delay(1);

      // Check points process
      //log.info(`[${currentCount}/${total}] Checking Node Points for Wallet: ${address}`);
      //const pointsStart = Date.now();
      const points = await socket.checkNodePoints();
      //log.debug(`[${currentCount}/${total}] Check points completed in ${Date.now() - pointsStart}ms`);
      log.debug(`[${currentCount}/${total}] Current points: ${points?.nodePoints || 'unknown'}`);
      
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      log.debug(`[${currentCount}/${total}] Total processing time: ${totalTime}s`);
      
      // Add small delay before sending success message
      await delay(1);
      parentPort.postMessage({ success: true });
    } catch (error) {
      const errorTime = Date.now() - startTime;
      log.error(`[${currentCount}/${total}] Operation failed after ${errorTime}ms`);
      log.error(`[${currentCount}/${total}] Error details: ${error.message}`);
      log.error(`[${currentCount}/${total}] Error stack: ${error.stack}`);
      throw error;
    }
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const errorStack = error.stack || '';
    log.error(`Worker error processing wallet:`);
    log.error(`- Message: ${errorMessage}`);
    log.error(`- Stack: ${errorStack}`);
    
    parentPort.postMessage({ 
      success: false, 
      error: errorMessage,
      type: errorMessage.includes('timed out') ? 'timeout' : 'error'
    });
  } finally {
    if (socket) {
      log.debug('Cleaning up socket connection');
      cleanupSocket(socket);
    }
  }
});

// Add socket cleanup function
function cleanupSocket(socket) {
  try {
    // Close the socket connection if it exists
    if (socket?.close) {
      socket.close();
    }
    log.debug('Socket connection cleaned up successfully');
  } catch (error) {
    log.error('Error cleaning up socket:', error);
  }
}
